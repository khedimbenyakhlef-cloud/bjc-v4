'use strict';

const db = require('../config/database');
const crypto = require('crypto');

const ENCRYPTION_KEY = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new Error('ENCRYPTION_KEY manquante ou trop courte (min 32 chars)');
  return key.slice(0, 32);
};

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY()), iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const [ivHex, encHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY()), iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString();
}

class EnvVar {
  static async upsert(appId, key, value, isSecret = false) {
    const valueEnc = encrypt(value);
    const { rows } = await db.query(
      `INSERT INTO env_vars (app_id, key, value_enc, is_secret)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (app_id, key) DO UPDATE SET value_enc=$3, is_secret=$4, updated_at=NOW()
       RETURNING id, app_id, key, is_secret, created_at`,
      [appId, key.toUpperCase().trim(), valueEnc, isSecret]
    );
    return rows[0];
  }

  static async findByApp(appId, includeValues = false) {
    const { rows } = await db.query(
      `SELECT id, app_id, key, is_secret, value_enc, created_at, updated_at
       FROM env_vars WHERE app_id=$1 ORDER BY key`,
      [appId]
    );
    return rows.map(r => ({
      ...r,
      value: includeValues ? decrypt(r.value_enc) : (r.is_secret ? '***' : decrypt(r.value_enc)),
      value_enc: undefined,
    }));
  }

  /** Retourne un objet clé=valeur déchiffré pour l'injection dans un container */
  static async getPlainObject(appId) {
    const { rows } = await db.query(
      'SELECT key, value_enc FROM env_vars WHERE app_id=$1', [appId]
    );
    const env = {};
    for (const r of rows) env[r.key] = decrypt(r.value_enc);
    return env;
  }

  static async delete(appId, key) {
    const { rowCount } = await db.query(
      'DELETE FROM env_vars WHERE app_id=$1 AND key=$2', [appId, key.toUpperCase()]
    );
    return rowCount > 0;
  }
}

module.exports = EnvVar;
