'use strict';

const { v4: uuidv4 } = require('uuid');
const App = require('../models/App');
const Deployment = require('../models/Deployment');
const EnvVar = require('../models/EnvVar');
const { minioClient, BUCKET } = require('../config/minio');
const deploymentQueue = require('../services/deploymentQueue');
const containerManager = require('../services/containerManager');
const { proxyRouter } = require('../services/proxyRouter');
const logger = require('../utils/logger');

const MAX_APPS = parseInt(process.env.MAX_APPS_PER_USER) || 10;

// ── POST /api/apps ────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { name, appType = 'static', runtime } = req.body;
    const count = await App.countByUser(req.user.id);
    if (count >= MAX_APPS) return res.status(403).json({ error: `Limite de ${MAX_APPS} applications atteinte` });
    const app = await App.create({ name, userId: req.user.id, appType, runtime });
    res.status(201).json(app);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nom déjà utilisé' });
    logger.error('create app', { error: err.message });
    res.status(500).json({ error: 'Impossible de créer l\'application' });
  }
};

// ── GET /api/apps ─────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const apps = await App.findByUser(req.user.id);
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: 'Erreur de récupération' });
  }
};

// ── GET /api/apps/:id ─────────────────────────────────────────
exports.get = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Application introuvable' });
    const deployments = await Deployment.findByApp(app.id);
    const envVars = await EnvVar.findByApp(app.id);
    res.json({ ...app, deployments, envVars });
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
};

// ── PATCH /api/apps/:id ────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const app = await App.update(req.params.id, req.user.id, req.body);
    if (!app) return res.status(404).json({ error: 'Application introuvable' });
    res.json(app);
  } catch (err) {
    res.status(500).json({ error: 'Mise à jour échouée' });
  }
};

// ── DELETE /api/apps/:id ──────────────────────────────────────
exports.delete = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Application introuvable' });
    // Arrêter le conteneur si full-stack
    if (app.container_id || app.app_type !== 'static') {
      await containerManager.removeContainer(`bjc-app-${app.slug}`);
    }
    await App.delete(app.id, req.user.id);
    res.status(204).send();
  } catch (err) {
    logger.error('delete app', { error: err.message });
    res.status(500).json({ error: 'Suppression échouée' });
  }
};

// ── GET /api/apps/:id/logs ────────────────────────────────────
exports.getLogs = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Application introuvable' });
    const tail = parseInt(req.query.tail) || 100;
    const containerName = `bjc-app-${app.slug}`;
    const logs = await containerManager.getContainerLogs(containerName, tail);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Logs indisponibles', detail: err.message });
  }
};

// ── GET /api/apps/:id/stats ───────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.id, req.user.id);
    if (!app) return res.status(404).json({ error: 'Application introuvable' });
    if (app.app_type === 'static') return res.json({ message: 'Pas de stats pour un site statique' });
    const stats = await containerManager.getContainerStats(`bjc-app-${app.slug}`);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Stats indisponibles' });
  }
};
