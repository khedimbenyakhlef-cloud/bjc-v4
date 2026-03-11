'use strict';

const AIService = require('../services/aiService');
const logger = require('../utils/logger');

// ── POST /api/ai/generate ────────────────────────────────────
exports.generate = async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await AIService.generate(prompt, req.user.id);
    res.json({ result });
  } catch (err) {
    logger.error('Erreur IA generate', { error: err.message, userId: req.user?.id });
    res.status(503).json({ error: err.message || 'Service IA indisponible' });
  }
};
