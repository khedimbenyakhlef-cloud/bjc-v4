'use strict';

const db = require('../config/database');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const ENCRYPTION_KEY = () => process.env.ENCRYPTION_KEY.slice(0, 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY()), iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text), cipher.final()]).toString('hex');
}

function decrypt(text) {
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY()), Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString();
}

class AppDatabase {
  static async create({ appId, dbType = 'postgres', password }) {
    const dbName = `bjc_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const dbUser = `u_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const enc = encrypt(password);
    const { rows } = await db.query(
      `INSERT INTO app_databases (app_id,db_type,db_name,db_user,db_password_enc)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,app_id,db_type,db_name,db_user,host,port,status,created_at`,
      [appId, dbType, dbName, dbUser, enc]
    );
    return rows[0];
  }

  static async findByApp(appId) {
    const { rows } = await db.query(
      'SELECT id,app_id,db_type,db_name,db_user,host,port,status,created_at FROM app_databases WHERE app_id=$1',
      [appId]
    );
    return rows;
  }

  static async getCredentials(id, appId) {
    const { rows } = await db.query(
      'SELECT * FROM app_databases WHERE id=$1 AND app_id=$2', [id, appId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return { ...r, password: decrypt(r.db_password_enc), db_password_enc: undefined };
  }

  static async updateStatus(id, status) {
    await db.query('UPDATE app_databases SET status=$1 WHERE id=$2', [status, id]);
  }
}

module.exports = AppDatabase;
