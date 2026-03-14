'use strict';
const router = require('express').Router();
const mime = require('mime-types');
const path = require('path');
const fs = require('fs');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const { minioClient, BUCKET } = require('../config/minio');
const { proxyMiddleware } = require('../services/proxyRouter');
const logger = require('../utils/logger');

router.use('/:slug', async (req, res, next) => {
  const { slug } = req.params;
  try {
    const app = await App.findBySlug(slug);
    if (!app) return res.status(404).send('Application introuvable');

    // Fonctions serverless (inchangé)
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

    // App full-stack → proxy (inchangé)
    if (app.app_type !== 'static' && app.container_id) {
      req.params.slug = slug;
      return proxyMiddleware(req, res, next);
    }

    // Site statique → servir depuis le stockage local
    if (!app.active_version) return res.status(503).send('Application pas encore déployée');

    // Récupérer le déploiement correspondant à la version active
    const deployments = await Deployment.findByApp(app.id, 100);
    const deployment = deployments.find(d => d.version_id === app.active_version);
    if (!deployment) {
      logger.error('Aucun déploiement trouvé pour la version active', { appId: app.id, version: app.active_version });
      return res.status(404).send('Déploiement introuvable');
    }

    const basePath = deployment.storage_path; // chemin du dossier extrait
    if (!basePath) return res.status(404).send('Chemin de stockage introuvable');

    const filePath = req.params[0] || 'index.html';
    const requestedPath = path.normalize(filePath);
    if (requestedPath.startsWith('..') || path.isAbsolute(requestedPath)) {
      return res.status(400).send('Chemin invalide');
    }

    const fullPath = path.join(basePath, requestedPath);
    if (!fullPath.startsWith(basePath)) {
      return res.status(400).send('Chemin invalide');
    }

    if (!fs.existsSync(fullPath)) {
      // Fallback vers index.html pour les SPA
      if (filePath !== 'index.html') {
        const fallbackPath = path.join(basePath, 'index.html');
        if (fs.existsSync(fallbackPath)) {
          const ct = mime.lookup('index.html') || 'text/html';
          res.set('Content-Type', ct);
          const stream = fs.createReadStream(fallbackPath);
          return stream.pipe(res);
        }
      }
      return res.status(404).send('Fichier introuvable');
    }

    const ct = mime.lookup(filePath) || 'application/octet-stream';
    res.set('Content-Type', ct);
    if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
  } catch (err) {
    logger.error('siteServe', { slug, error: err.message, stack: err.stack });
    res.status(500).send('Erreur interne');
  }
});

module.exports = router;