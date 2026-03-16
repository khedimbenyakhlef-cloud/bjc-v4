'use strict';
const r = require('express').Router();
const c = require('../controllers/appController');
const auth = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const AdmZip = require('adm-zip');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const { minioClient, BUCKET } = require('../config/minio');
const logger = require('../utils/logger');

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

r.post('/:id/deploy', uploadLimiter, upload.single('zipFile'), async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    if (!req.file) return res.status(400).json({ error: 'Fichier ZIP requis' });

    const appId = Number(app.id);
    const versionId = uuidv4();
    const storagePath = `apps/${req.user.id}/${app.id}/${versionId}`;

    // Extraction du ZIP en memoire
    const zip = new AdmZip(req.file.buffer);
    let entries = zip.getEntries().filter(e => {
      if (e.isDirectory) return false;
      const norm = path.normalize(e.entryName);
      return !norm.startsWith('..') && !path.isAbsolute(norm);
    });

    if (!entries.length) return res.status(400).json({ error: 'ZIP vide ou invalide' });

    // Detecter dossier racine unique et aplatir
    const roots = [...new Set(entries.map(e => e.entryName.split('/')[0]))];
    let prefix = '';
    if (roots.length === 1 && entries.every(e => e.entryName.startsWith(roots[0] + '/'))) {
      prefix = roots[0] + '/';
    }

    // Upload vers B2
    if (!minioClient) return res.status(500).json({ error: 'Stockage B2 non configure' });

    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(batch.map(async (entry) => {
        const content = entry.getData();
        const relativeName = prefix ? entry.entryName.slice(prefix.length) : entry.entryName;
        if (!relativeName) return;
        const objName = `${storagePath}/${relativeName}`;
        await minioClient.putObject(BUCKET, objName, content, content.length);
      }));
    }

    logger.info('Fichiers uploades vers B2', { appId, versionId, count: entries.length });

    // Enregistrement en base
    const deployment = await Deployment.create({ appId, versionId, storagePath });
    await App.setActiveVersion(app.id, versionId);
    await Deployment.updateStatus(deployment.id, 'success');

    res.status(202).json({
      message: 'Deploiement reussi',
      deploymentId: deployment.id,
      versionId,
      status: 'active',
    });
  } catch (err) {
    logger.error('deploy error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Deploiement echoue: ' + err.message });
  }
});

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
    if (!dep || dep.app_id !== app.id) return res.status(404).json({ error: 'Deploiement introuvable' });
    res.json(dep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = r;