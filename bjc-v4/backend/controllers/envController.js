'use strict';

const App = require('../models/App');
const EnvVar = require('../models/EnvVar');
const containerManager = require('../services/containerManager');
const logger = require('../utils/logger');

exports.list = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const vars = await EnvVar.findByApp(app.id, false); // masquer les secrets
    res.json(vars);
  } catch (err) { res.status(500).json({ error: 'Erreur' }); }
};

exports.upsert = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const { key, value, isSecret = false } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key et value requis' });
    const envVar = await EnvVar.upsert(app.id, key, value, isSecret);
    logger.info('EnvVar upserted', { appId: app.id, key });
    res.json(envVar);
  } catch (err) { res.status(500).json({ error: 'Erreur' }); }
};

exports.delete = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const deleted = await EnvVar.delete(app.id, req.params.key);
    if (!deleted) return res.status(404).json({ error: 'Variable introuvable' });
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: 'Erreur' }); }
};
