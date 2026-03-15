'use strict';

const logger = require('../utils/logger');

let minioClient = null;
const BUCKET = process.env.B2_BUCKET || 'bjc-sites';

async function ensureBucket() {
  if (!minioClient) {
    logger.warn('Stockage B2 non configure');
    return;
  }
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET);
      logger.info(`Bucket "${BUCKET}" cree`);
    }
  } catch (err) {
    logger.error('Erreur initialisation stockage', { error: err.message });
  }
}

if (process.env.B2_ENDPOINT && process.env.B2_KEY_ID) {
  const Minio = require('minio');
  minioClient = new Minio.Client({
    endPoint: process.env.B2_ENDPOINT,
    port: 443,
    useSSL: true,
    accessKey: process.env.B2_KEY_ID,
    secretKey: process.env.B2_APP_KEY,
    pathStyle: true,
  });
  logger.info('Stockage Backblaze B2 initialise');
}

module.exports = { minioClient, BUCKET, ensureBucket };