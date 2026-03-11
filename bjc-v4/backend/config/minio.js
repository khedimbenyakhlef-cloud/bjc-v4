'use strict';

const logger = require('../utils/logger');

let minioClient = null;
const BUCKET = process.env.MINIO_BUCKET || 'sites';

async function ensureBucket() {
  if (!minioClient) {
    logger.warn('MinIO non configuré, stockage fichiers désactivé');
    return;
  }
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
      logger.info(`Bucket MinIO "${BUCKET}" créé`);
    }
  } catch (err) {
    logger.error('Erreur initialisation MinIO', { error: err.message });
  }
}

if (process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY) {
  const Minio = require('minio');
  minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
  });
}

module.exports = { minioClient, BUCKET, ensureBucket };
