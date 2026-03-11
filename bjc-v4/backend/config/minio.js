'use strict';

const Minio = require('minio');
const logger = require('../utils/logger');

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const BUCKET = process.env.MINIO_BUCKET || 'sites';

/**
 * S'assure que le bucket existe, le crée si nécessaire.
 * Applique une policy publique en lecture pour servir les sites.
 */
async function ensureBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
      logger.info(`Bucket MinIO "${BUCKET}" créé`);

      // Policy publique en lecture pour servir les fichiers statiques
      const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKET}/*`],
        }],
      });
      await minioClient.setBucketPolicy(BUCKET, policy);
      logger.info(`Policy publique appliquée sur le bucket "${BUCKET}"`);
    }
  } catch (err) {
    logger.error('Erreur initialisation MinIO', { error: err.message });
    throw err;
  }
}

module.exports = { minioClient, BUCKET, ensureBucket };
