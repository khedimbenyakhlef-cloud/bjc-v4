'use strict';

/**
 * CronScheduler — gère les tâches planifiées de toutes les applications.
 * Tourne dans le processus principal et utilise node-cron.
 */

const cron = require('node-cron');
const CronJob = require('../models/CronJob');
const containerManager = require('./containerManager');
const logger = require('../utils/logger');

const activeTasks = new Map(); // jobId -> cron.Task

async function start() {
  // Charger tous les jobs actifs au démarrage
  await reload();
  // Recharger toutes les 5 minutes (pour les nouveaux jobs)
  setInterval(reload, 5 * 60 * 1000);
  logger.info('CronScheduler démarré');
}

async function reload() {
  try {
    const jobs = await CronJob.findActive();

    // Arrêter les tâches supprimées
    for (const [id] of activeTasks) {
      if (!jobs.find(j => j.id === id)) {
        activeTasks.get(id).destroy();
        activeTasks.delete(id);
        logger.debug(`CronJob #${id} supprimé`);
      }
    }

    // Créer/mettre à jour les tâches actives
    for (const job of jobs) {
      if (activeTasks.has(job.id)) continue;
      if (!cron.validate(job.schedule)) {
        logger.warn(`CronJob #${job.id}: schedule invalide "${job.schedule}"`);
        continue;
      }

      const task = cron.schedule(job.schedule, async () => {
        logger.info(`CronJob #${job.id} "${job.name}" exécuté`);
        try {
          if (job.container_id) {
            const output = await containerManager.execInContainer(job.container_id, job.command);
            logger.debug(`CronJob #${job.id} output: ${output.slice(0, 200)}`);
          }
          await CronJob.updateLastRun(job.id);
        } catch (err) {
          logger.error(`CronJob #${job.id} erreur`, { error: err.message });
        }
      });

      activeTasks.set(job.id, task);
      logger.debug(`CronJob #${job.id} "${job.name}" programmé (${job.schedule})`);
    }
  } catch (err) {
    logger.error('CronScheduler reload erreur', { error: err.message });
  }
}

function stop(jobId) {
  if (activeTasks.has(jobId)) {
    activeTasks.get(jobId).destroy();
    activeTasks.delete(jobId);
  }
}

module.exports = { start, reload, stop };
