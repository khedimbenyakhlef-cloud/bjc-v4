'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const session = require('express-session');
const RedisStore = require('connect-redis').default;

const { initDB } = require('./models');
const redisClient = require('./config/redis');
const { ensureBucket } = require('./config/minio');
const containerManager = require('./services/containerManager');
const cronScheduler = require('./services/cronScheduler');
const { loadRoutes } = require('./services/proxyRouter');
const passport = require('./config/passport');
const { apiLimiter, authLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));

const origins = (process.env.FRONTEND_URL || 'http://localhost').split(',').map(s => s.trim());
app.use(cors({ origin: (o, cb) => (!o || origins.includes(o)) ? cb(null, true) : cb(new Error(`CORS: ${o}`)), credentials: true }));
app.use(compression());
app.use(morgan('combined', { stream: { write: m => logger.http(m.trim()) }, skip: r => r.url === '/health' }));

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'fallback-change-me',
  resave: false, saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 86400000, sameSite: 'lax' },
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../frontend'), { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 }));

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Routes API ───────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/apps', require('./routes/apps'));
app.use('/api/apps/:appId/env', require('./routes/envVars'));
app.use('/api/apps/:appId/functions', require('./routes/functions'));
app.use('/api/apps/:appId/crons', require('./routes/crons'));
app.use('/api/apps/:appId/databases', require('./routes/databases'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/admin', require('./routes/admin'));

// ── Sites / apps déployées ───────────────────────────────────
app.use('/site', require('./routes/siteServe'));

// ── Health check ─────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ status: 'ok', version: '4.0.0', ts: new Date().toISOString() });
  } catch { res.status(503).json({ status: 'degraded' }); }
});

app.use(errorHandler);

const PORT = parseInt(process.env.PORT) || 3000;

async function start() {
  try {
    await initDB();
    await ensureBucket();
    await containerManager.ensureAppNetwork();
    await loadRoutes();
    await cronScheduler.start();

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Beny-Joe Cloud V4 démarré sur le port ${PORT}`);
    });
  } catch (err) {
    logger.error('Échec démarrage', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { logger.info('SIGTERM reçu'); process.exit(0); });
process.on('unhandledRejection', (r) => logger.error('Unhandled rejection', { reason: String(r) }));

start();
module.exports = app;
