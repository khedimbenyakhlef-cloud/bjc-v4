'use strict';

const db = require('../config/database');

class ServerlessFunction {
  static async create({ appId, name, runtime = 'nodejs18', code, timeoutMs = 10000, memoryMb = 128 }) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { rows } = await db.query(
      `INSERT INTO functions (app_id, name, slug, runtime, code, timeout_ms, memory_mb)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [appId, name.trim(), slug, runtime, code, timeoutMs, memoryMb]
    );
    return rows[0];
  }

  static async findByApp(appId) {
    const { rows } = await db.query(
      'SELECT * FROM functions WHERE app_id=$1 ORDER BY name', [appId]
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query('SELECT * FROM functions WHERE id=$1', [id]);
    return rows[0] || null;
  }

  static async findBySlug(appId, slug) {
    const { rows } = await db.query(
      'SELECT * FROM functions WHERE app_id=$1 AND slug=$2', [appId, slug]
    );
    return rows[0] || null;
  }

  static async update(id, appId, { code, timeoutMs, memoryMb, runtime }) {
    const { rows } = await db.query(
      `UPDATE functions SET code=COALESCE($1,code), timeout_ms=COALESCE($2,timeout_ms),
       memory_mb=COALESCE($3,memory_mb), runtime=COALESCE($4,runtime)
       WHERE id=$5 AND app_id=$6 RETURNING *`,
      [code, timeoutMs, memoryMb, runtime, id, appId]
    );
    return rows[0] || null;
  }

  static async delete(id, appId) {
    const { rowCount } = await db.query('DELETE FROM functions WHERE id=$1 AND app_id=$2', [id, appId]);
    return rowCount > 0;
  }

  static async recordInvocation(id, status, durationMs, output, error) {
    await db.query(`UPDATE functions SET invoke_count=invoke_count+1, last_invoked=NOW() WHERE id=$1`, [id]);
    await db.query(
      `INSERT INTO function_logs (function_id,status,duration_ms,output,error)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, status, durationMs, output?.slice(0, 8000) || null, error?.slice(0, 2000) || null]
    );
  }

  static async getLogs(id, limit = 50) {
    const { rows } = await db.query(
      `SELECT * FROM function_logs WHERE function_id=$1 ORDER BY invoked_at DESC LIMIT $2`,
      [id, limit]
    );
    return rows;
  }
}

module.exports = ServerlessFunction;
