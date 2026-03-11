'use strict';

const App = require('../models/App');
const CronJob = require('../models/CronJob');
const cronScheduler = require('../services/cronScheduler');

exports.list = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  res.json(await CronJob.findByApp(app.id));
};

exports.create = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const { name, schedule, command } = req.body;
  if (!name || !schedule || !command) return res.status(400).json({ error: 'name, schedule et command requis' });
  const job = await CronJob.create({ appId: app.id, name, schedule, command });
  await cronScheduler.reload();
  res.status(201).json(job);
};

exports.toggle = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const job = await CronJob.toggle(req.params.jobId, app.id, req.body.isActive);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  await cronScheduler.reload();
  res.json(job);
};

exports.delete = async (req, res) => {
  const app = await App.findByIdAndUser(req.params.appId, req.user.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  const ok = await CronJob.delete(req.params.jobId, app.id);
  if (!ok) return res.status(404).json({ error: 'Job introuvable' });
  await cronScheduler.reload();
  res.status(204).send();
};
