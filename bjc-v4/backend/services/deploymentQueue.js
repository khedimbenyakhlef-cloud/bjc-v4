'use strict';

const Queue = require('bull');
const AdmZip = require('adm-zip');
const path = require('path');
const tar = require('tar');
const { Readable } = require('stream');
const { minioClient, BUCKET } = require('../config/minio');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const EnvVar = require('../models/EnvVar');
const containerManager = require('./containerManager');
const logger = require('../utils/logger');

const redisConfig = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const deploymentQueue = new Queue('deployments-v4', { redis: redisConfig });

// ── Détection du type de projet ──────────────────────────────
function detectRuntime(entries) {
  const names = entries.map(e => path.basename(e.entryName).toLowerCase());
  if (names.includes('package.json')) {
    // Vérifier si c'est juste du statique
    const hasServerFile = entries.some(e =>
      ['server.js','app.js','index.js','main.js'].some(s => e.entryName.endsWith(s))
    );
    const hasIndexHtml = names.includes('index.html');
    if (hasIndexHtml && !hasServerFile) return { runtime: 'static', startCmd: null };
    return { runtime: 'nodejs18', startCmd: 'node index.js' };
  }
  if (names.includes('requirements.txt')) return { runtime: 'python311', startCmd: 'python app.py' };
  if (names.includes('composer.json')) return { runtime: 'php82', startCmd: 'php -S 0.0.0.0:3000' };
  // Fallback statique
  return { runtime: 'static', startCmd: null };
}

// ── Worker principal ─────────────────────────────────────────
deploymentQueue.process(async (job) => {
  const { deploymentId, appId, versionId, zipObjectName, storagePath } = job.data;
  logger.info(`[Worker] Déploiement démarré`, { jobId: job.id, appId, versionId });
  await Deployment.updateStatus(deploymentId, 'processing');

  const log = async (line) => {
    logger.debug(`[Deploy ${appId}] ${line}`);
    await Deployment.appendLog(deploymentId, `[${new Date().toISOString()}] ${line}`);
  };

  try {
    await log('📥 Téléchargement du ZIP depuis MinIO...');
    await job.progress(10);

    const zipStream = await minioClient.getObject(BUCKET, zipObjectName);
    const chunks = [];
    for await (const chunk of zipStream) chunks.push(chunk);
    const zipBuffer = Buffer.concat(chunks);
    await log(`✅ ZIP téléchargé (${Math.round(zipBuffer.length / 1024)} KB)`);

    // Extraire
    await log('📦 Extraction du ZIP...');
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().filter(e => {
      if (e.isDirectory) return false;
      const norm = path.normalize(e.entryName);
      return !norm.startsWith('..') && !path.isAbsolute(norm) && e.entryName.length < 255;
    });

    if (!entries.length) throw new Error('ZIP vide ou invalide');
    await log(`📂 ${entries.length} fichiers trouvés`);

    // Détecter le runtime
    const { runtime, startCmd: detectedStartCmd } = detectRuntime(entries);
    await log(`🔍 Runtime détecté: ${runtime}`);
    await job.progress(25);

    // Récupérer l'app pour les éventuelles overrides
    const app = await App.findById(appId);
    const finalRuntime = app.runtime || runtime;
    const startCmd = app.start_command || detectedStartCmd;

    // Upload des fichiers extraits vers MinIO
    await log('⬆️  Upload des fichiers vers MinIO...');
    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(batch.map(async (entry) => {
        const content = entry.getData();
        const objName = `${storagePath}/${entry.entryName}`;
        await minioClient.putObject(BUCKET, objName, content, content.length);
      }));
      await job.progress(25 + Math.floor((i / entries.length) * 35));
    }
    await log(`✅ ${entries.length} fichiers uploadés`);
    await job.progress(60);

    if (finalRuntime === 'static') {
      // Déploiement statique — pas de conteneur
      await App.setActiveVersion(appId, versionId);
      await App.update(appId, app.user_id, { status: 'active', runtime: 'static' });
      await log('🚀 Site statique déployé avec succès !');
      await log(`🔗 URL: https://${app.domain}`);
    } else {
      // Déploiement full-stack — lancer un conteneur
      await log(`🐳 Démarrage du conteneur ${finalRuntime}...`);

      // Créer une archive tar des fichiers pour l'injection dans le container
      const envVars = await EnvVar.getPlainObject(appId);

      const containerPort = 3000;
      const result = await containerManager.startContainer({
        appId,
        slug: app.slug,
        runtime: finalRuntime,
        startCommand: startCmd,
        envVars,
        port: containerPort,
        cpuLimit: app.cpu_limit || '0.5',
        memLimit: app.memory_limit || '256m',
      });

      await log(`✅ Conteneur démarré: ${result.containerName}`);
      await log(`📍 IP interne: ${result.networkIp}`);

      await App.setActiveVersion(appId, versionId);
      await App.update(appId, app.user_id, {
        status: 'active',
        container_id: result.containerId,
        container_port: containerPort,
        runtime: finalRuntime,
      });

      await log(`🚀 Application déployée avec succès !`);
      await log(`🔗 URL: https://${app.domain}`);
    }

    await job.progress(100);
    await Deployment.updateStatus(deploymentId, 'success');
    logger.info(`[Worker] Déploiement réussi`, { appId, versionId });
    return { success: true };
  } catch (err) {
    logger.error(`[Worker] Échec déploiement`, { appId, error: err.message });
    await Deployment.updateStatus(deploymentId, 'failed', err.message);
    if (app) await App.update(appId, app.user_id, { status: 'error' });
    throw err;
  }
});

deploymentQueue.on('completed', (job) => logger.info(`Job #${job.id} terminé`));
deploymentQueue.on('failed', (job, err) => logger.error(`Job #${job.id} échoué`, { error: err.message }));

module.exports = deploymentQueue;
