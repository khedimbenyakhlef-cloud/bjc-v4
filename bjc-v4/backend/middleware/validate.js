'use strict';

const Joi = require('joi');

/**
 * Middleware de validation Joi.
 * @param {Joi.Schema} schema - Schéma Joi à valider contre req.body
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
    return res.status(400).json({ error: 'Données invalides', details });
  }
  req.body = value; // données nettoyées
  next();
};

// ── Schémas ──────────────────────────────────────────────────
const schemas = {
  register: Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    password: Joi.string().min(8).max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .message('Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre')
      .required(),
    name: Joi.string().trim().min(2).max(80).optional(),
  }),

  login: Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    password: Joi.string().required(),
  }),

  createSite: Joi.object({
    name: Joi.string().trim().min(3).max(50)
      .pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i)
      .message('Le nom ne peut contenir que des lettres, chiffres et tirets, sans commencer/finir par un tiret')
      .required(),
  }),

  aiGenerate: Joi.object({
    prompt: Joi.string().trim().min(5).max(2000).required(),
  }),
};

module.exports = { validate, schemas };
