'use strict';
const logger = require('../utils/logger');

const DOCKER_AVAILABLE = !!process.env.DOCKER_SOCKET || false;

async function startContainer(opts) {
  if (!DOCKER_AVAILABLE) {
    logger.warn('Docker non disponible, déploiement conteneurs désactivé');
    return { id: 'mock', name: opts.slug };
  }
}

async function stopContainer(nameOrId) {
  if (!DOCKER_AVAILABLE) return;
}

async function removeContainer(nameOrId) {
  if (!DOCKER_AVAILABLE) return;
}

async function getContainerStats(nameOrId) {
  if (!DOCKER_AVAILABLE) return null;
}

async function listManagedContainers() {
  if (!DOCKER_AVAILABLE) return [];
}

module.exports = { startContainer, stopContainer, removeContainer, getContainerStats, listManagedContainers };
