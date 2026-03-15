'use strict';
const router = require('express').Router();
const mime = require('mime-types');
const path = require('path');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const { proxyMiddleware } = require('../services/proxyRouter');
const { minioClient, BUCKET } = require('../config/minio');
const logger = require('../utils/logger');

router.use('/:slug*', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const app = await App.findBySlug(slug);
    if (!app) return res.status(404).send('Application introuvable');

    // Fonctions serverless
    if (req.path.startsWith('/api/')) {
      const fnSlug = req.path.replace('/api/', '').split('/')[0];
      const ServerlessFunction = require('../models/Function');
      const EnvVar = require('../models/EnvVar');
      const functionRunner = require('../services/functionRunner');
      const fn = await ServerlessFunction.findBySlug(app.id, fnSlug);
      if (fn) {
        const envVars = await EnvVar.getPlainObject(app.id);
        const event = { method: req.method, path: req.path, query: req.query, body: req.body, headers: req.headers };
        const result = await functionRunner.invoke(fn, event, envVars);
        await ServerlessFunction.recordInvocation(fn.id, result.status, result.durationMs, result.output, result.error);
        if (result.status === 'error') return res.status(500).json({ error: result.error });
        try { return res.json(JSON.parse(result.output)); } catch { return res.send(result.output); }
      }
    }

    // App full-stack
    if (app.app_type !== 'static' && app.container_id) {
      req.params.slug = slug;
      return proxyMiddleware(req, res, next);
    }

    // Site statique
    if (!app.active_version) return res.status(503).send('Application pas encore déployée');

    const deployments = await Deployment.findByApp(app.id, 100);
    const deployment = deployments.find(d => d.version_id === app.active_version);
    if (!deployment) return res.status(404).send('Déploiement introuvable');

    const storagePath = deployment.storage_path;
    if (!storagePath) return res.status(404).send('Chemin de stockage introuvable');

    // Extraire le chemin du fichier demandé
    const reqPath = req.params[0] ? req.params[0].replace(/^\//, '') : '';
    let filePath = reqPath || 'index.html';

    // Sécurité : pas de path traversal
    const normalized = path.normalize(filePath);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return res.status(400).send('Chemin invalide');
    }

    const objectName = `${storagePath}/${filePath}`;

    // Lire depuis MinIO
    try {
      const stream = await minioClient.getObject(BUCKET, objectName);
      const ct = mime.lookup(filePath) || 'application/octet-stream';
      res.set('Content-Type', ct);
      if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/.test(filePath)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return stream.pipe(res);
    } catch (err) {
      // Fichier non trouvé → fallback index.html (SPA)
      if (err.code === 'NoSuchKey' || err.message.includes('Not Found')) {
        if (filePath !== 'index.html') {
          try {
            const fallback = await minioClient.getObject(BUCKET, `${storagePath}/index.html`);
            res.set('Content-Type', 'text/html');
            return fallback.pipe(res);
          } catch {
            return res.status(404).send('Fichier introuvable');
          }
        }
        return res.status(404).send('Fichier introuvable');
      }
      throw err;
    }
  } catch (err) {
    logger.error('siteServe', { slug, error: err.message });
    res.status(500).send('Erreur interne');
  }
});

module.exports = router;
