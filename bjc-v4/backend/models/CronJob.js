'use strict';

const db = require('../config/database');

class CronJob {
  static async create({ appId, name, schedule, command }) {
    const { rows } = await db.query(
      `INSERT INTO cron_jobs (app_id, name, schedule, command) VALUES ($1,$2,$3,$4) RETURNING *`,
      [appId, name, schedule, command]
    );
    return rows[0];
  }

  static async findByApp(appId) {
    const { rows } = await db.query('SELECT * FROM cron_jobs WHERE app_id=$1 ORDER BY name', [appId]);
    return rows;
  }

  static async findActive() {
    const { rows } = await db.query('SELECT cj.*, a.container_id, a.slug FROM cron_jobs cj JOIN apps a ON a.id=cj.app_id WHERE cj.is_active=true AND a.status=\'active\'');
    return rows;
  }

  static async updateLastRun(id) {
    await db.query('UPDATE cron_jobs SET last_run=NOW() WHERE id=$1', [id]);
  }

  static async toggle(id, appId, isActive) {
    const { rows } = await db.query(
      'UPDATE cron_jobs SET is_active=$1 WHERE id=$2 AND app_id=$3 RETURNING *',
      [isActive, id, appId]
    );
    return rows[0] || null;
  }

  static async delete(id, appId) {
    const { rowCount } = await db.query('DELETE FROM cron_jobs WHERE id=$1 AND app_id=$2', [id, appId]);
    return rowCount > 0;
  }
}

module.exports = CronJob;
