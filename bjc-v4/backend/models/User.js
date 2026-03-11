'use strict';

const db = require('../config/database');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;

class User {
  /**
   * Crée un utilisateur avec email/mot de passe.
   */
  static async create({ email, password, name }) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { rows } = await db.query(
      `INSERT INTO users (email, password, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, role, avatar_url, created_at`,
      [email.toLowerCase().trim(), hashedPassword, name?.trim() || null]
    );
    return rows[0];
  }

  /**
   * Crée un utilisateur via Google OAuth (sans mot de passe).
   */
  static async createFromGoogle({ email, name, googleId, avatarUrl }) {
    const { rows } = await db.query(
      `INSERT INTO users (email, name, google_id, avatar_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, avatar_url, google_id`,
      [email.toLowerCase().trim(), name?.trim() || null, googleId, avatarUrl || null]
    );
    return rows[0];
  }

  /**
   * Lie un compte Google à un compte email existant.
   */
  static async linkGoogleAccount(id, googleId, avatarUrl) {
    const { rows } = await db.query(
      `UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2)
       WHERE id = $3
       RETURNING id, email, name, role, avatar_url, google_id`,
      [googleId, avatarUrl || null, id]
    );
    return rows[0];
  }

  static async findByEmail(email) {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await db.query(
      'SELECT id, email, name, role, avatar_url, google_id, created_at FROM users WHERE id = $1 AND is_active = true',
      [id]
    );
    return rows[0] || null;
  }

  static async findByGoogleId(googleId) {
    const { rows } = await db.query(
      'SELECT id, email, name, role, avatar_url, google_id FROM users WHERE google_id = $1 AND is_active = true',
      [googleId]
    );
    return rows[0] || null;
  }

  /**
   * Vérifie le mot de passe (retourne false si compte Google sans password).
   */
  static async verifyPassword(user, password) {
    if (!user.password) return false;
    return bcrypt.compare(password, user.password);
  }

  /**
   * Compte le nombre de sites d'un utilisateur.
   */
  static async countSites(userId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS count FROM sites WHERE user_id = $1',
      [userId]
    );
    return rows[0].count;
  }
}

module.exports = User;
