'use strict';

/**
 * FunctionRunner — exécution isolée des fonctions serverless.
 * 
 * Stratégie : chaque invocation lance un sous-processus Node.js isolé
 * via vm2 (sandbox) ou un conteneur Docker éphémère selon le runtime.
 * En V4, on utilise un subprocess Node.js avec timeout strict pour Node,
 * et un conteneur Docker éphémère pour Python/PHP.
 */

const { spawn } = require('child_process');
const Docker = require('dockerode');
const logger = require('../utils/logger');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

const RUNTIME_IMAGES = {
  nodejs18: 'node:18-alpine',
  nodejs20: 'node:20-alpine',
  python311: 'python:3.11-slim',
  python312: 'python:3.12-slim',
};

/**
 * Invoque une fonction serverless de façon isolée.
 * @param {Object} fn - objet fonction depuis la DB
 * @param {Object} event - payload de l'invocation
 * @param {Object} envVars - variables d'environnement
 * @returns {{ output, error, durationMs, status }}
 */
async function invoke(fn, event = {}, envVars = {}) {
  const start = Date.now();

  if (fn.runtime.startsWith('nodejs')) {
    return invokeNode(fn, event, envVars, start);
  } else if (fn.runtime.startsWith('python')) {
    return invokeDocker(fn, event, envVars, start);
  } else {
    return { output: null, error: 'Runtime non supporté: ' + fn.runtime, durationMs: 0, status: 'error' };
  }
}

/**
 * Exécute du code Node.js dans un sous-processus sandboxé.
 * Le code reçoit `event` et `context` et doit exporter un `handler`.
 */
async function invokeNode(fn, event, envVars, start) {
  const wrapper = `
const { vm } = require('node:vm');
const userCode = ${JSON.stringify(fn.code)};
const event = ${JSON.stringify(event)};
const context = { functionName: ${JSON.stringify(fn.name)}, runtime: ${JSON.stringify(fn.runtime)} };

(async () => {
  try {
    // Sandbox minimal
    const sandbox = { exports: {}, module: { exports: {} }, console: { log: (...a) => process.stdout.write(a.join(' ') + '\\n'), error: (...a) => process.stderr.write(a.join(' ') + '\\n') }, require: (m) => { if (['crypto','path','url','querystring'].includes(m)) return require(m); throw new Error('Module non autorisé: ' + m); } };
    const script = new (require('vm').Script)(userCode + '\\n; module.exports = exports;');
    const ctx = require('vm').createContext(sandbox);
    script.runInContext(ctx);
    const handler = sandbox.module.exports.handler || sandbox.exports.handler;
    if (typeof handler !== 'function') throw new Error('La fonction doit exporter un handler(event, context)');
    const result = await handler(event, context);
    process.stdout.write(JSON.stringify({ result }));
    process.exit(0);
  } catch(e) {
    process.stderr.write(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
})();
`;

  return new Promise((resolve) => {
    const envList = { ...process.env, ...envVars, NODE_PATH: '' };
    const proc = spawn(process.execPath, ['-e', wrapper], {
      env: envList,
      timeout: fn.timeout_ms,
      maxBuffer: fn.memory_mb * 1024 * 10,
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const durationMs = Date.now() - start;
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout);
          resolve({ output: JSON.stringify(parsed.result, null, 2), error: null, durationMs, status: 'success' });
        } catch {
          resolve({ output: stdout, error: null, durationMs, status: 'success' });
        }
      } else {
        let errMsg = stderr;
        try { errMsg = JSON.parse(stderr).error; } catch {}
        resolve({ output: stdout || null, error: errMsg, durationMs, status: 'error' });
      }
    });

    proc.on('error', (err) => {
      resolve({ output: null, error: err.message, durationMs: Date.now() - start, status: 'error' });
    });
  });
}

/**
 * Exécute du code Python dans un conteneur Docker éphémère.
 */
async function invokeDocker(fn, event, envVars, start) {
  const image = RUNTIME_IMAGES[fn.runtime] || 'python:3.11-slim';
  const script = fn.runtime.startsWith('python')
    ? wrapPython(fn.code, event)
    : fn.code;

  const envList = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

  try {
    const [output, container] = await docker.run(image, ['sh', '-c', `echo ${JSON.stringify(script)} | python3`], process.stdout, {
      Env: envList,
      HostConfig: {
        NetworkMode: 'none', // isolation réseau totale
        Memory: fn.memory_mb * 1024 * 1024,
        AutoRemove: true,
        ReadonlyRootfs: true,
      },
    });

    const durationMs = Date.now() - start;
    return { output: output?.toString() || null, error: null, durationMs, status: 'success' };
  } catch (err) {
    return { output: null, error: err.message, durationMs: Date.now() - start, status: 'error' };
  }
}

function wrapPython(code, event) {
  return `
import json, sys
event = json.loads('''${JSON.stringify(event)}''')
${code}
try:
    result = handler(event, {})
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`;
}

module.exports = { invoke };
