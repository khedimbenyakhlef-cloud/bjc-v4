const logger = require('./logger');

let redisClient = null;

if (process.env.REDIS_URL) {
  const Redis = require('ioredis');
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  redisClient.on('connect', () => logger.info('Redis connecté'));
  redisClient.on('error', (err) => logger.error('Erreur Redis', { error: err.message }));
}

module.exports = redisClient;
