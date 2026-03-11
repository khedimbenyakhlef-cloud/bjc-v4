'use strict';

const App = require('../models/App');
const AppDatabase = require('../models/AppDatabase');
const { provisionPostgres } = require('../services/databaseProvisioner');
const logger = require('../utils/logger');

exports.list = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  res.json(await AppDatabase.findByApp(app.id));
};

exports.provision = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const existing = await AppDatabase.findByApp(app.id);
    if (existing.length >= 2) return res.status(403).json({ error: 'Maximum 2 bases de données par application' });
    const { dbType = 'postgres' } = req.body;
    if (dbType !== 'postgres') return res.status(400).json({ error: 'Seul PostgreSQL est supporté pour l\'instant' });
    const result = await provisionPostgres(app.id);
    logger.info('DB provisionnée', { appId: app.id, dbName: result.dbName });
    res.status(201).json(result);
  } catch (err) {
    logger.error('provision DB', { error: err.message });
    res.status(500).json({ error: 'Provisionnement échoué: ' + err.message });
  }
};

exports.getCredentials = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const creds = await AppDatabase.getCredentials(req.params.dbId, app.id);
  if (!creds) return res.status(404).json({ error: 'Base introuvable' });
  res.json(creds);
};
