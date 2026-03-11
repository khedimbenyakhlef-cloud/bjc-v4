'use strict';

const App = require('../models/App');
const ServerlessFunction = require('../models/Function');
const EnvVar = require('../models/EnvVar');
const functionRunner = require('../services/functionRunner');
const logger = require('../utils/logger');

exports.list = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const fns = await ServerlessFunction.findByApp(app.id);
  res.json(fns);
};

exports.create = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const { name, runtime = 'nodejs18', code, timeoutMs, memoryMb } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name et code requis' });
    const fn = await ServerlessFunction.create({ appId: app.id, name, runtime, code, timeoutMs, memoryMb });
    res.status(201).json(fn);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nom de fonction déjà utilisé' });
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const fn = await ServerlessFunction.update(req.params.fnId, app.id, req.body);
    if (!fn) return res.status(404).json({ error: 'Fonction introuvable' });
    res.json(fn);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.delete = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const ok = await ServerlessFunction.delete(req.params.fnId, app.id);
  if (!ok) return res.status(404).json({ error: 'Fonction introuvable' });
  res.status(204).send();
};

exports.invoke = async (req, res) => {
  try {
    const app = await App.findByIdAndUser(req.params.appId, req.user.id);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    const fn = await ServerlessFunction.findById(req.params.fnId);
    if (!fn || fn.app_id !== app.id) return res.status(404).json({ error: 'Fonction introuvable' });
    const envVars = await EnvVar.getPlainObject(app.id);
    const event = req.body || {};
    const result = await functionRunner.invoke(fn, event, envVars);
    await ServerlessFunction.recordInvocation(fn.id, result.status, result.durationMs, result.output, result.error);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLogs = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const fn = await ServerlessFunction.findById(req.params.fnId);
  if (!fn || fn.app_id !== app.id) return res.status(404).json({ error: 'Fonction introuvable' });
  const logs = await ServerlessFunction.getLogs(fn.id, parseInt(req.query.limit) || 50);
  res.json(logs);
};
