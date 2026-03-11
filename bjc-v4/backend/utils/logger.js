'use strict';

const winston = require('winston');

const { combine, timestamp, json, simple, colorize, printf } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${metaStr}`;
  })
);

const prodFormat = combine(timestamp(), json());

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [
          new winston.transports.File({ filename: '/var/log/app/error.log', level: 'error' }),
          new winston.transports.File({ filename: '/var/log/app/combined.log' }),
        ]
      : []),
  ],
});

// Ajout d'un niveau http pour morgan
if (!winston.config.npm.levels.http) {
  logger.add(new winston.transports.Console({ level: 'http' }));
}

module.exports = logger;
