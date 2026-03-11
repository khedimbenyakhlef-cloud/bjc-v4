'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function safeUser(user) {
  const { password, ...safe } = user; // eslint-disable-line no-unused-vars
  return safe;
}

// ── POST /api/auth/register ──────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Un compte avec cet email existe déjà' });
    }

    const user = await User.create({ email, password, name });
    const token = generateToken(user.id);

    logger.info('Nouvel utilisateur inscrit', { userId: user.id, email: user.email });
    res.status(201).json({ user: safeUser(user), token });
  } catch (err) {
    logger.error('Erreur inscription', { error: err.message });
    res.status(500).json({ error: 'Échec de l\'inscription' });
  }
};

// ── POST /api/auth/login ─────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      // Réponse identique pour éviter l'énumération d'emails
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const valid = await User.verifyPassword(user, password);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const token = generateToken(user.id);
    logger.info('Connexion réussie', { userId: user.id });
    res.json({ user: safeUser(user), token });
  } catch (err) {
    logger.error('Erreur connexion', { error: err.message });
    res.status(500).json({ error: 'Échec de la connexion' });
  }
};

// ── GET /api/auth/me ─────────────────────────────────────────
exports.me = (req, res) => {
  res.json(req.user);
};

// ── GET /api/auth/google/callback ───────────────────────────
exports.googleCallback = (req, res) => {
  try {
    const token = generateToken(req.user.id);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost';
    // Redirige vers le frontend avec le token dans le fragment URL (jamais loggé côté serveur)
    res.redirect(`${frontendUrl}/?token=${token}`);
  } catch (err) {
    logger.error('Erreur callback Google', { error: err.message });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost'}/?error=oauth_failed`);
  }
};
