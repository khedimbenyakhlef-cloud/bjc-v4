'use strict';
const r = require('express').Router();
const c = require('../controllers/appController');
const auth = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');

// ── Stockage local (sans MinIO) ───────────────────────────────
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '../storage');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 100) * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.zip') || file.mimetype.includes('zip'))
      return cb(null, true);
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

// ── POST /:id/deploy ──────────────────────────────────────────
r.post('/:id/deploy', uploadLimiter, upload.single('zipFile'), async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    if (!req.file) return res.status(400).json({ error: 'Fichier ZIP requis' });

    const versionId = uuidv4();
    const appStorageDir = path.join(STORAGE_DIR, String(req.user.id), String(app.id), versionId);
    fs.mkdirSync(appStorageDir, { recursive: true });

    // Sauvegarder le ZIP localement
    fs.writeFileSync(path.join(appStorageDir, 'site.zip'), req.file.buffer);

    // Enregistrer en DB
    const deployment = await Deployment.create({
      appId: app.id,
      versionId,
      storagePath: appStorageDir,
    });

    // Mettre à jour le statut → active
    await App.setActiveVersion(app.id, versionId);
    await Deployment.updateStatus(deployment.id, 'success');

    logger.info('Déploiement réussi', { appId: app.id, versionId, userId: req.user.id });

    res.status(202).json({
      message: 'Déploiement réussi',
      deploymentId: deployment.id,
      versionId,
      status: 'active',
    });
  } catch (err) {
    logger.error('deploy error', { error: err.message });
    res.status(500).json({ error: 'Déploiement échoué: ' + err.message });
  }
});

// ── GET /:id/deployments ──────────────────────────────────────
r.get('/:id/deployments', async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    res.json(await Deployment.findByApp(app.id, 20));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/:id/deployments/:depId', async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const dep = await Deployment.findById(req.params.depId);
    if (!dep || dep.app_id !== app.id) return res.status(404).json({ error: 'Déploiement introuvable' });
    res.json(dep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = r;
