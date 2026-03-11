'use strict';

const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const Site = require('../models/Site');
const Deployment = require('../models/Deployment');
const { minioClient, BUCKET } = require('../config/minio');
const deploymentQueue = require('../services/deploymentQueue');
const logger = require('../utils/logger');

const MAX_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 50;

// Multer en mémoire (le fichier ne touche jamais le disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip')
    ) {
      return cb(null, true);
    }
    cb(Object.assign(new Error('Seuls les fichiers ZIP sont acceptés'), { statusCode: 400 }));
  },
});

// ── POST /api/deploy ─────────────────────────────────────────
exports.deploySite = [
  upload.single('zipFile'),
  async (req, res) => {
    const { siteId } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'siteId est requis' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Fichier ZIP requis' });
    }

    // Vérifier la propriété du site
    const site = await Site.findByIdAndUser(siteId, req.user.id);
    if (!site) {
      return res.status(404).json({ error: 'Site introuvable' });
    }

    const versionId = uuidv4();
    const storagePath = `${site.storage_prefix}/versions/${versionId}`;
    const zipObjectName = `${storagePath}/.source/site.zip`;

    try {
      // Upload du zip source vers MinIO (streaming depuis buffer mémoire)
      const zipBuffer = req.file.buffer;
      await minioClient.putObject(BUCKET, zipObjectName, zipBuffer, zipBuffer.length, {
        'Content-Type': 'application/zip',
        'x-amz-meta-site-id': String(site.id),
        'x-amz-meta-version-id': versionId,
      });

      // Enregistrement en base
      const deployment = await Deployment.create({ siteId: site.id, versionId, storagePath });

      // Ajout à la file d'attente
      const job = await deploymentQueue.add(
        {
          deploymentId: deployment.id,
          siteId: site.id,
          versionId,
          zipObjectName,
          storagePath,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        }
      );

      logger.info('Déploiement mis en file d\'attente', {
        jobId: job.id,
        siteId: site.id,
        versionId,
        userId: req.user.id,
      });

      res.status(202).json({
        message: 'Déploiement en cours de traitement',
        deploymentId: deployment.id,
        versionId,
        jobId: job.id,
      });
    } catch (err) {
      logger.error('Erreur déploiement', { error: err.message, siteId, userId: req.user.id });
      res.status(500).json({ error: 'Échec du déploiement' });
    }
  },
];

// ── GET /api/deploy/:siteId/history ──────────────────────────
exports.getHistory = async (req, res) => {
  try {
    const site = await Site.findByIdAndUser(req.params.siteId, req.user.id);
    if (!site) return res.status(404).json({ error: 'Site introuvable' });
    const deployments = await Deployment.findBySite(site.id);
    res.json(deployments);
  } catch (err) {
    logger.error('Erreur historique déploiements', { error: err.message });
    res.status(500).json({ error: 'Impossible de récupérer l\'historique' });
  }
};
