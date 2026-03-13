'use strict';

const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'benyjoecloud.com';

class Site {
  /**
   * Crée un site. Le slug et le storage_prefix sont dérivés du nom.
   * Chaque utilisateur a un espace isolé: users/{userId}/sites/{slug}/
   */
  static async create({ name, userId }) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const domain = `${slug}.${BASE_DOMAIN}`;
    const storagePrefix = `users/${userId}/sites/${slug}`;

    const { rows } = await db.query(
      `INSERT INTO sites (name, slug, domain, user_id, storage_prefix)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name.trim(), slug, domain, userId, storagePrefix]
    );
    return rows[0];
  }

  static async findByUser(userId) {
    const { rows } = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM deployments d WHERE d.site_id = s.id)::int AS deployment_count
       FROM sites s
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query('SELECT * FROM sites WHERE id = $1::integer', [id]);
    return rows[0] || null;
  }

  static async findByIdAndUser(id, userId) {
    const { rows } = await db.query(
      'SELECT * FROM sites WHERE id = $1::integer AND user_id = $2::integer',
      [id, userId]
    );
    return rows[0] || null;
  }

  static async findByDomain(domain) {
    const { rows } = await db.query('SELECT * FROM sites WHERE domain = $1', [domain]);
    return rows[0] || null;
  }

  static async findBySlug(slug) {
    const { rows } = await db.query('SELECT * FROM sites WHERE slug = $1', [slug]);
    return rows[0] || null;
  }

  /**
   * Met à jour la version active et le statut après un déploiement réussi.
   */
  static async setActiveVersion(id, versionId) {
    await db.query(
      `UPDATE sites SET active_version = $1, status = 'active' WHERE id = $2::integer`,
      [versionId, id]
    );
  }

  static async delete(id, userId) {
    const { rowCount } = await db.query(
      'DELETE FROM sites WHERE id = $1::integer AND user_id = $2::integer',
      [id, userId]
    );
    return rowCount > 0;
  }
}

module.exports = Site;