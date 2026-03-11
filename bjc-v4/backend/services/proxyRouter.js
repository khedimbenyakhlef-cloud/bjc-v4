'use strict';

/**
 * ProxyRouter — route les requêtes vers les conteneurs des applications.
 * Maintient une table de routage en mémoire (slug → containerIP:port).
 * La table est populée depuis la base de données au démarrage et mise à jour
 * à chaque déploiement.
 */

const httpProxy = require('http-proxy');
const App = require('../models/App');
const logger = require('../utils/logger');

const proxy = httpProxy.createProxyServer({ changeOrigin: true });

proxy.on('error', (err, req, res) => {
  logger.error('Proxy error', { error: err.message, url: req.url });
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Application temporairement indisponible' }));
  }
});

// Table en mémoire : slug → target URL
const routeTable = new Map();

async function loadRoutes() {
  // Chargé à la demande : la table est mise à jour par les événements de déploiement
  logger.info('ProxyRouter initialisé (routes chargées à la demande)');
}

function setRoute(slug, target) {
  routeTable.set(slug, target);
  logger.debug(`Route ajoutée: ${slug} → ${target}`);
}

function removeRoute(slug) {
  routeTable.delete(slug);
}

/**
 * Middleware Express qui route les apps full-stack.
 * À utiliser sur /site/:slug/* pour les apps de type non-static.
 */
async function proxyMiddleware(req, res, next) {
  const slug = req.params.slug;
  if (!slug) return next();

  let target = routeTable.get(slug);

  if (!target) {
    // Chercher en DB
    const app = await App.findBySlug(slug);
    if (!app || app.app_type === 'static' || !app.container_port) return next();
    // Les conteneurs sont dans le réseau bjc_apps, accessible par nom
    const containerName = `bjc-app-${slug}`;
    target = `http://${containerName}:${app.container_port}`;
    routeTable.set(slug, target);
  }

  proxy.web(req, res, { target });
}

module.exports = { loadRoutes, setRoute, removeRoute, proxyMiddleware };
