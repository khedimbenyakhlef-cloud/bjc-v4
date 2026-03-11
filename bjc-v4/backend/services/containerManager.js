'use strict';

/**
 * ContainerManager — gestion des conteneurs Docker via Dockerode.
 * Chaque application full-stack reçoit son propre conteneur isolé.
 */

const Docker = require('dockerode');
const logger = require('../utils/logger');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// Images de base par runtime
const RUNTIME_IMAGES = {
  'nodejs18':  'node:18-alpine',
  'nodejs20':  'node:20-alpine',
  'python311': 'python:3.11-slim',
  'python312': 'python:3.12-slim',
  'php82':     'php:8.2-cli-alpine',
  'static':    'nginx:alpine',
};

// Labels communs pour identifier les conteneurs gérés
const LABEL_MANAGED = 'bjc.managed=true';

/**
 * Lance un conteneur pour une application.
 * @param {Object} opts
 * @param {string} opts.appId
 * @param {string} opts.slug
 * @param {string} opts.runtime
 * @param {string} opts.startCommand
 * @param {Object} opts.envVars - objet clé/valeur en clair
 * @param {number} opts.port - port interne de l'app
 * @param {string} opts.imagePath - image Docker ou tag
 * @param {string} opts.workDir - répertoire de travail dans le container
 * @param {string} opts.cpuLimit - ex: '0.5'
 * @param {string} opts.memLimit - ex: '256m'
 */
async function startContainer({ appId, slug, runtime, startCommand, envVars = {}, port = 3000, cpuLimit = '0.5', memLimit = '256m' }) {
  const image = RUNTIME_IMAGES[runtime] || 'node:18-alpine';
  const containerName = `bjc-app-${slug}`;

  // Supprimer un éventuel ancien conteneur
  await removeContainer(containerName);

  // Préparer les variables d'environnement
  const envList = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
  envList.push(`PORT=${port}`);
  envList.push(`BJC_APP_ID=${appId}`);

  // Convertir cpuLimit (ex "0.5") en nano-CPUs
  const nanoCpus = Math.floor(parseFloat(cpuLimit) * 1e9);

  const container = await docker.createContainer({
    Image: image,
    name: containerName,
    Cmd: startCommand ? startCommand.split(' ') : undefined,
    Env: envList,
    Labels: {
      'bjc.managed': 'true',
      'bjc.appId': String(appId),
      'bjc.slug': slug,
      'bjc.runtime': runtime,
    },
    HostConfig: {
      // Isolation réseau : réseau dédié aux apps
      NetworkMode: 'bjc_apps',
      // Limites de ressources
      NanoCpus: nanoCpus,
      Memory: parseMemory(memLimit),
      MemorySwap: parseMemory(memLimit) * 2,
      // Pas de capabilities dangereuses
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      // Lecture seule du FS sauf /tmp
      ReadonlyRootfs: false, // mis à false pour compatibilité, activer en prod avancée
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
      RestartPolicy: { Name: 'unless-stopped' },
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '10m', 'max-file': '3' },
      },
    },
    ExposedPorts: { [`${port}/tcp`]: {} },
  });

  await container.start();
  logger.info(`Conteneur démarré: ${containerName}`, { appId, runtime });

  // Récupérer les infos du conteneur
  const info = await container.inspect();
  return {
    containerId: info.Id,
    containerName,
    internalPort: port,
    networkIp: info.NetworkSettings?.Networks?.bjc_apps?.IPAddress || null,
  };
}

/**
 * Arrête et supprime un conteneur par nom.
 */
async function removeContainer(nameOrId) {
  try {
    const container = docker.getContainer(nameOrId);
    const info = await container.inspect();
    if (info.State.Running) await container.stop({ t: 10 });
    await container.remove({ force: true });
    logger.info(`Conteneur supprimé: ${nameOrId}`);
  } catch (err) {
    if (err.statusCode !== 404) {
      logger.warn(`Impossible de supprimer le conteneur ${nameOrId}`, { error: err.message });
    }
  }
}

/**
 * Récupère les logs d'un conteneur (dernières N lignes).
 */
async function getContainerLogs(nameOrId, tail = 100) {
  try {
    const container = docker.getContainer(nameOrId);
    const logs = await container.logs({ stdout: true, stderr: true, tail, timestamps: true });
    return logs.toString();
  } catch (err) {
    return `Logs indisponibles: ${err.message}`;
  }
}

/**
 * Récupère les stats CPU/RAM d'un conteneur.
 */
async function getContainerStats(nameOrId) {
  try {
    const container = docker.getContainer(nameOrId);
    const stats = await container.stats({ stream: false });
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPct = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;
    const memMb = stats.memory_stats.usage / (1024 * 1024);
    return { cpuPct: Math.round(cpuPct * 100) / 100, memMb: Math.round(memMb * 100) / 100 };
  } catch {
    return { cpuPct: 0, memMb: 0 };
  }
}

/**
 * Exécute une commande dans un conteneur existant (pour cron jobs).
 */
async function execInContainer(nameOrId, command) {
  const container = docker.getContainer(nameOrId);
  const exec = await container.exec({
    Cmd: ['sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  return new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', (chunk) => { output += chunk.toString(); });
    stream.on('end', () => resolve(output));
    stream.on('error', reject);
    setTimeout(() => resolve(output), 30000); // timeout 30s
  });
}

/**
 * S'assure que le réseau dédié aux apps existe.
 */
async function ensureAppNetwork() {
  try {
    await docker.getNetwork('bjc_apps').inspect();
  } catch {
    await docker.createNetwork({
      Name: 'bjc_apps',
      Driver: 'bridge',
      Options: { 'com.docker.network.bridge.name': 'bjc_apps' },
      Labels: { 'bjc.managed': 'true' },
    });
    logger.info('Réseau Docker bjc_apps créé');
  }
}

/**
 * Copie des fichiers (tar) dans un conteneur depuis un Buffer.
 */
async function copyToContainer(nameOrId, tarBuffer, destPath = '/app') {
  const container = docker.getContainer(nameOrId);
  await container.putArchive(tarBuffer, { path: destPath });
}

function parseMemory(mem) {
  const m = mem.toLowerCase();
  if (m.endsWith('m')) return parseInt(m) * 1024 * 1024;
  if (m.endsWith('g')) return parseInt(m) * 1024 * 1024 * 1024;
  return parseInt(m);
}

module.exports = {
  startContainer,
  removeContainer,
  getContainerLogs,
  getContainerStats,
  execInContainer,
  ensureAppNetwork,
  copyToContainer,
  RUNTIME_IMAGES,
};
