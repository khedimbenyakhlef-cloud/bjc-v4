'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error('Erreur inattendue sur client PostgreSQL inactif', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('Nouveau client PostgreSQL connecté');
});

/**
 * Exécute une requête SQL avec paramètres.
 * @param {string} text
 * @param {Array} [params]
 */
const query = (text, params) => pool.query(text, params);

/**
 * Récupère un client pour les transactions manuelles.
 * Toujours appeler client.release() dans un finally.
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
