'use strict';

const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'benyjoecloud.com';

class App {
  static async create({ name, userId, appType = 'static', runtime = null }) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const domain = `${slug}.${BASE_DOMAIN}`;
    const storagePrefix = `users/${userId}/apps/${slug}`;
    const { rows } = await db.query(
      `INSERT INTO apps (name, slug, domain, user_id, storage_prefix, app_type, runtime)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name.trim(), slug, domain, userId, storagePrefix, appType, runtime]
    );
    return rows[0];
  }

  static async findByUser(userId) {
    const { rows } = await db.query(
      `SELECT a.*,
         (SELECT COUNT(*) FROM deployments d WHERE d.app_id = a.id)::int AS deployment_count,
         (SELECT COUNT(*) FROM functions f WHERE f.app_id = a.id)::int AS function_count
       FROM apps a WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query('SELECT * FROM apps WHERE id = $1', [id]);
    return rows[0] || null;
  }

  static async findByIdAndUser(id, userId) {
    const { rows } = await db.query('SELECT * FROM apps WHERE id = $1 AND user_id = $2', [id, userId]);
    return rows[0] || null;
  }

  static async findBySlug(slug) {
    const { rows } = await db.query('SELECT * FROM apps WHERE slug = $1', [slug]);
    return rows[0] || null;
  }

  static async findByDomain(domain) {
    const { rows } = await db.query(
      'SELECT * FROM apps WHERE domain = $1 OR custom_domain = $1', [domain]
    );
    return rows[0] || null;
  }

  static async update(id, userId, fields) {
    const allowed = ['status','active_version','container_id','container_port',
                     'start_command','build_command','cpu_limit','memory_limit',
                     'ssl_enabled','custom_domain','runtime'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) { sets.push(`${k} = $${i++}`); vals.push(v); }
    }
    if (!sets.length) return null;
    vals.push(id, userId);
    const { rows } = await db.query(
      `UPDATE apps SET ${sets.join(', ')} WHERE id = $${i} AND user_id = $${i+1} RETURNING *`,
      vals
    );
    return rows[0] || null;
  }

  static async setActiveVersion(id, versionId) {
    await db.query(`UPDATE apps SET active_version=$1, status='active' WHERE id=$2`, [versionId, id]);
  }

  static async delete(id, userId) {
    const { rowCount } = await db.query('DELETE FROM apps WHERE id=$1 AND user_id=$2', [id, userId]);
    return rowCount > 0;
  }

  static async countByUser(userId) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM apps WHERE user_id=$1', [userId]);
    return rows[0].c;
  }
}

module.exports = App;
