'use strict';
const r = require('express').Router();
const c = require('../controllers/appController');
const auth = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const { minioClient, BUCKET } = require('../config/minio');
const deploymentQueue = require('../services/deploymentQueue');
const logger = require('../utils/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 100) * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.zip') || file.mimetype.includes('zip')) return cb(null, true);
    cb(Object.assign(new Error('ZIP uniquement'), { statusCode: 400 }));
  },
});

r.use(auth);
r.get('/', c.list);
r.post('/', c.create);
r.get('/:id', c.get);
r.patch('/:id', c.update);
r.delete('/:id', c.delete);
r.get('/:id/logs', c.getLogs);
r.get('/:id/stats', c.getStats);

// Deploy
r.post('/:id/deploy', uploadLimiter, upload.single('zipFile'), async (req, res) => {
  const app = await App.findByIdAndUser(req.params.id, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Fichier ZIP requis' });

  const versionId = uuidv4();
  const storagePath = `${app.storage_prefix}/versions/${versionId}`;
  const zipObjectName = `${storagePath}/.source/site.zip`;

  try {
    const buf = req.file.buffer;
    await minioClient.putObject(BUCKET, zipObjectName, buf, buf.length, { 'Content-Type': 'application/zip' });
    const deployment = await Deployment.create({ appId: app.id, versionId, storagePath });
    const job = await deploymentQueue.add(
      { deploymentId: deployment.id, appId: app.id, versionId, zipObjectName, storagePath },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50 }
    );
    logger.info('Déploiement en queue', { jobId: job.id, appId: app.id });
    res.status(202).json({ message: 'Déploiement en cours', deploymentId: deployment.id, versionId, jobId: job.id });
  } catch (err) {
    logger.error('deploy', { error: err.message });
    res.status(500).json({ error: 'Déploiement échoué' });
  }
});

// Deployment status
r.get('/:id/deployments', async (req, res) => {
  const app = await App.findByIdAndUser(req.params.id, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  res.json(await Deployment.findByApp(app.id, 20));
});

r.get('/:id/deployments/:depId', async (req, res) => {
  const app = await App.findByIdAndUser(req.params.id, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const dep = await Deployment.findById(req.params.depId);
  if (!dep || dep.app_id !== app.id) return res.status(404).json({ error: 'Déploiement introuvable' });
  res.json(dep);
});

module.exports = r;
