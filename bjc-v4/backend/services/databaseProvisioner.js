'use strict';

/**
 * DatabaseProvisioner — crée des bases de données isolées pour chaque application.
 * Stratégie : base partagée PostgreSQL avec USER + DATABASE dédiés par app.
 * Chaque app a ses propres credentials et ne peut accéder qu'à sa propre base.
 */

const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');
const AppDatabase = require('../models/AppDatabase');
const logger = require('../utils/logger');

/**
 * Provisionne une base PostgreSQL pour une application.
 * @param {number} appId
 * @returns {Object} - infos de connexion (sans mot de passe en clair en DB)
 */
async function provisionPostgres(appId) {
  const password = generateSecurePassword();
  const dbRecord = await AppDatabase.create({ appId, dbType: 'postgres', password });

  const adminClient = new Client({ connectionString: process.env.DATABASE_URL });
  await adminClient.connect();

  try {
    // Créer l'utilisateur avec un mot de passe fort
    await adminClient.query(`CREATE USER "${dbRecord.db_user}" WITH PASSWORD '${password.replace(/'/g, "''")}'`);
    // Créer la base de données appartenant à cet utilisateur
    await adminClient.query(`CREATE DATABASE "${dbRecord.db_name}" OWNER "${dbRecord.db_user}"`);
    // Révoquer les accès publics
    await adminClient.query(`REVOKE ALL ON DATABASE "${dbRecord.db_name}" FROM PUBLIC`);
    // Donner tous les droits à l'utilisateur
    await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbRecord.db_name}" TO "${dbRecord.db_user}"`);

    await AppDatabase.updateStatus(dbRecord.id, 'ready');
    logger.info('Base de données provisionnée', { appId, dbName: dbRecord.db_name });

    return {
      id: dbRecord.id,
      dbType: 'postgres',
      host: process.env.DB_HOST_FOR_APPS || 'postgres',
      port: 5432,
      dbName: dbRecord.db_name,
      dbUser: dbRecord.db_user,
      password,
      connectionString: `postgresql://${dbRecord.db_user}:${password}@${process.env.DB_HOST_FOR_APPS || 'postgres'}:5432/${dbRecord.db_name}`,
    };
  } catch (err) {
    await AppDatabase.updateStatus(dbRecord.id, 'error');
    // Nettoyage best-effort
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbRecord.db_name}"`);
      await adminClient.query(`DROP USER IF EXISTS "${dbRecord.db_user}"`);
    } catch {}
    throw err;
  } finally {
    await adminClient.end();
  }
}

/**
 * Supprime une base de données provisionnée.
 */
async function deprovisionPostgres(dbName, dbUser) {
  const adminClient = new Client({ connectionString: process.env.DATABASE_URL });
  await adminClient.connect();
  try {
    await adminClient.query(`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${dbName}' AND pid <> pg_backend_pid()
    `);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminClient.query(`DROP USER IF EXISTS "${dbUser}"`);
    logger.info('Base de données supprimée', { dbName, dbUser });
  } finally {
    await adminClient.end();
  }
}

function generateSecurePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#%^&*';
  const crypto = require('crypto');
  let pwd = '';
  for (let i = 0; i < 32; i++) {
    pwd += chars[crypto.randomInt(0, chars.length)];
  }
  return pwd;
}

module.exports = { provisionPostgres, deprovisionPostgres };
