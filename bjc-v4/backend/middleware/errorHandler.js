'use strict';

const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  // Erreurs CORS
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ error: err.message });
  }

  // Erreurs Multer
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Fichier trop volumineux (max ${process.env.MAX_UPLOAD_SIZE_MB || 50} MB)` });
  }

  // Erreurs PostgreSQL connues
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Cette ressource existe déjà' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Référence invalide' });
  }

  // Erreur générique
  const statusCode = err.statusCode || err.status || 500;
  logger.error('Erreur non gérée', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
  });

  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production' ? 'Erreur interne du serveur' : err.message,
  });
};
