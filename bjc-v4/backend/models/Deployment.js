'use strict';

const db = require('../config/database');

class Deployment {
  static async create({ appId, versionId, storagePath }) {
    const numericAppId = Number(appId);
    const { rows } = await db.query(
      `INSERT INTO deployments (app_id, version_id, storage_path) VALUES ($1::integer, $2, $3) RETURNING *`,
      [numericAppId, versionId, storagePath]
    );
    return rows[0];
  }

  static async updateStatus(id, status, logs = null) {
    const numericId = Number(id);
    await db.query(
      `UPDATE deployments SET status=$1::text, logs=COALESCE($2::text, logs),
       deployed_at=CASE WHEN $1::text='success' THEN NOW() ELSE deployed_at END WHERE id=$3::integer`,
      [status, logs, numericId]
    );
  }

  static async appendLog(id, line) {
    const numericId = Number(id);
    await db.query(
      `UPDATE deployments SET logs=COALESCE(logs,'')||$1 WHERE id=$2::integer`,
      [line + '\n', numericId]
    );
  }

  static async findByApp(appId, limit = 10) {
    const numericAppId = Number(appId);
    const numericLimit = Number(limit);
    const { rows } = await db.query(
      'SELECT * FROM deployments WHERE app_id=$1::integer ORDER BY created_at DESC LIMIT $2',
      [numericAppId, numericLimit]
    );
    return rows;
  }

  static async findById(id) {
    const numericId = Number(id);
    const { rows } = await db.query('SELECT * FROM deployments WHERE id=$1::integer', [numericId]);
    return rows[0] || null;
  }
}

module.exports = Deployment;