'use strict';

const path = require('path');
const mime = require('mime-types');

/**
 * Sanitise un nom de fichier.
 */
function sanitizeFileName(name) {
  return path.basename(name).replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
}

/**
 * Retourne le Content-Type d'un fichier.
 */
function getContentType(filePath) {
  return mime.lookup(filePath) || 'application/octet-stream';
}

/**
 * Transforme un nom en slug URL-safe.
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Attente asynchrone.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { sanitizeFileName, getContentType, toSlug, sleep };
