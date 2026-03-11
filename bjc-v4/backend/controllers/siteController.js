'use strict';

const Site = require('../models/Site');
const Deployment = require('../models/Deployment');
const User = require('../models/User');
const logger = require('../utils/logger');

const MAX_SITES_PER_USER = parseInt(process.env.MAX_SITES_PER_USER) || 10;

// ── POST /api/sites ──────────────────────────────────────────
exports.createSite = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    // Vérifier la limite de sites par utilisateur
    const siteCount = await User.countSites(userId);
    if (siteCount >= MAX_SITES_PER_USER) {
      return res.status(403).json({
        error: `Limite atteinte : vous ne pouvez pas avoir plus de ${MAX_SITES_PER_USER} sites`,
      });
    }

    const site = await Site.create({ name, userId });
    logger.info('Site créé', { siteId: site.id, userId, name });
    res.status(201).json(site);
  } catch (err) {
    logger.error('Erreur création site', { error: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Un site avec ce nom existe déjà' });
    }
    res.status(500).json({ error: 'Impossible de créer le site' });
  }
};

// ── GET /api/sites ───────────────────────────────────────────
exports.getSites = async (req, res) => {
  try {
    const sites = await Site.findByUser(req.user.id);
    res.json(sites);
  } catch (err) {
    logger.error('Erreur récupération sites', { error: err.message });
    res.status(500).json({ error: 'Impossible de récupérer les sites' });
  }
};

// ── GET /api/sites/:id ───────────────────────────────────────
exports.getSite = async (req, res) => {
  try {
    const site = await Site.findByIdAndUser(req.params.id, req.user.id);
    if (!site) return res.status(404).json({ error: 'Site introuvable' });
    const deployments = await Deployment.findBySite(site.id);
    res.json({ ...site, deployments });
  } catch (err) {
    logger.error('Erreur récupération site', { error: err.message });
    res.status(500).json({ error: 'Impossible de récupérer le site' });
  }
};

// ── DELETE /api/sites/:id ─────────────────────────────────────
exports.deleteSite = async (req, res) => {
  try {
    const deleted = await Site.delete(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Site introuvable' });
    logger.info('Site supprimé', { siteId: req.params.id, userId: req.user.id });
    res.status(204).send();
  } catch (err) {
    logger.error('Erreur suppression site', { error: err.message });
    res.status(500).json({ error: 'Impossible de supprimer le site' });
  }
};
