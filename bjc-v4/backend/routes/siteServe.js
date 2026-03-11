'use strict';
const router = require('express').Router();
const mime = require('mime-types');
const path = require('path');
const App = require('../models/App');
const { minioClient, BUCKET } = require('../config/minio');
const { proxyMiddleware } = require('../services/proxyRouter');
const logger = require('../utils/logger');

router.use('/:slug', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const app = await App.findBySlug(slug);
    if (!app) return res.status(404).send('Application introuvable');

    // Fonctions serverless publiques: /site/:slug/api/:fnSlug
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

    // App full-stack → proxy vers le conteneur
    if (app.app_type !== 'static' && app.container_id) {
      req.params.slug = slug;
      return proxyMiddleware(req, res, next);
    }

    // Site statique → servir depuis MinIO
    if (!app.active_version) return res.status(503).send('Application pas encore déployée');

    const filePath = req.params[0] || 'index.html';
    const normalized = path.normalize(filePath);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return res.status(400).send('Chemin invalide');

    const objectName = `${app.storage_prefix}/versions/${app.active_version}/${filePath}`;
    let stream;
    try {
      stream = await minioClient.getObject(BUCKET, objectName);
    } catch (minioErr) {
      if (minioErr.code === 'NoSuchKey' && filePath !== 'index.html') {
        const idx = await minioClient.getObject(BUCKET, `${app.storage_prefix}/versions/${app.active_version}/index.html`).catch(() => null);
        if (idx) { res.set('Content-Type', 'text/html'); return idx.pipe(res); }
        return res.status(404).send('Fichier introuvable');
      }
      if (minioErr.code === 'NoSuchKey') return res.status(404).send('Fichier introuvable');
      throw minioErr;
    }
    const ct = mime.lookup(filePath) || 'application/octet-stream';
    res.set('Content-Type', ct);
    if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    stream.pipe(res);
  } catch (err) {
    logger.error('siteServe', { slug, error: err.message });
    res.status(500).send('Erreur interne');
  }
});

module.exports = router;
