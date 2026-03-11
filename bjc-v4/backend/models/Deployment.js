'use strict';

const db = require('../config/database');

class Deployment {
  static async create({ appId, versionId, storagePath }) {
    const { rows } = await db.query(
      `INSERT INTO deployments (app_id, version_id, storage_path) VALUES ($1,$2,$3) RETURNING *`,
      [appId, versionId, storagePath]
    );
    return rows[0];
  }

  static async updateStatus(id, status, logs = null) {
    await db.query(
      `UPDATE deployments SET status=$1, logs=COALESCE($2,logs),
       deployed_at=CASE WHEN $1='success' THEN NOW() ELSE deployed_at END WHERE id=$3`,
      [status, logs, id]
    );
  }

  static async appendLog(id, line) {
    await db.query(
      `UPDATE deployments SET logs=COALESCE(logs,'')||$1 WHERE id=$2`,
      [line + '\n', id]
    );
  }

  static async findByApp(appId, limit = 10) {
    const { rows } = await db.query(
      'SELECT * FROM deployments WHERE app_id=$1 ORDER BY created_at DESC LIMIT $2',
      [appId, limit]
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query('SELECT * FROM deployments WHERE id=$1', [id]);
    return rows[0] || null;
  }
}

module.exports = Deployment;
