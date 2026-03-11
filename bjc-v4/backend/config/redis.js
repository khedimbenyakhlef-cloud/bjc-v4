'use strict';

const Redis = require('ioredis');
const logger = require('../utils/logger');

const redisOptions = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,    // requis par Bull
  enableReadyCheck: false,       // requis par Bull
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 3000);
    logger.warn(`Redis: tentative de reconnexion #${times} dans ${delay}ms`);
    return delay;
  },
  lazyConnect: false,
};

const redisClient = new Redis(redisOptions);

redisClient.on('connect', () => logger.info('Redis connecté'));
redisClient.on('error', (err) => logger.error('Erreur Redis', { error: err.message }));
redisClient.on('reconnecting', () => logger.warn('Redis: reconnexion en cours...'));

module.exports = redisClient;
