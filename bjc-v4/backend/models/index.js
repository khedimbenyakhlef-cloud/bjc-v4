'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

async function initDB() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // ── Users ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id           SERIAL PRIMARY KEY,
        email        VARCHAR(255) UNIQUE NOT NULL,
        password     VARCHAR(255),
        name         VARCHAR(100),
        google_id    VARCHAR(100) UNIQUE,
        avatar_url   TEXT,
        role         VARCHAR(20) NOT NULL DEFAULT 'user',
        is_active    BOOLEAN NOT NULL DEFAULT true,
        plan         VARCHAR(20) NOT NULL DEFAULT 'free',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);

    // ── Apps (remplace "sites") ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        slug            VARCHAR(100) UNIQUE NOT NULL,
        domain          VARCHAR(255) UNIQUE NOT NULL,
        custom_domain   VARCHAR(255) UNIQUE,
        ssl_enabled     BOOLEAN NOT NULL DEFAULT false,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_prefix  VARCHAR(255) UNIQUE NOT NULL,
        active_version  VARCHAR(36),
        app_type        VARCHAR(30) NOT NULL DEFAULT 'static',
        status          VARCHAR(20) NOT NULL DEFAULT 'pending',
        container_id    VARCHAR(128),
        container_port  INTEGER,
        runtime         VARCHAR(30),
        start_command   TEXT,
        build_command   TEXT,
        cpu_limit       VARCHAR(10) DEFAULT '0.5',
        memory_limit    VARCHAR(10) DEFAULT '256m',
        replicas        INTEGER DEFAULT 1,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_apps_user_id ON apps(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_apps_domain ON apps(domain)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_apps_custom_domain ON apps(custom_domain)`);

    // ── Deployments ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployments (
        id              SERIAL PRIMARY KEY,
        app_id          INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        version_id      VARCHAR(36) NOT NULL,
        storage_path    VARCHAR(255) NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'queued',
        logs            TEXT,
        build_duration  INTEGER,
        deployed_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_deployments_app_id ON deployments(app_id)`);

    // ── Environment variables (chiffrées) ───────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS env_vars (
        id          SERIAL PRIMARY KEY,
        app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        key         VARCHAR(255) NOT NULL,
        value_enc   TEXT NOT NULL,
        is_secret   BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(app_id, key)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_env_vars_app_id ON env_vars(app_id)`);

    // ── Serverless functions ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS functions (
        id          SERIAL PRIMARY KEY,
        app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        slug        VARCHAR(100) NOT NULL,
        runtime     VARCHAR(30) NOT NULL DEFAULT 'nodejs18',
        code        TEXT NOT NULL,
        timeout_ms  INTEGER NOT NULL DEFAULT 10000,
        memory_mb   INTEGER NOT NULL DEFAULT 128,
        status      VARCHAR(20) NOT NULL DEFAULT 'active',
        invoke_count BIGINT NOT NULL DEFAULT 0,
        last_invoked TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(app_id, slug)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_functions_app_id ON functions(app_id)`);

    // ── Function logs ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS function_logs (
        id          SERIAL PRIMARY KEY,
        function_id INTEGER NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
        status      VARCHAR(10) NOT NULL,
        duration_ms INTEGER,
        output      TEXT,
        error       TEXT,
        invoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_function_logs_fn ON function_logs(function_id)`);

    // ── Databases provisionnées ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_databases (
        id              SERIAL PRIMARY KEY,
        app_id          INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        db_type         VARCHAR(20) NOT NULL DEFAULT 'postgres',
        db_name         VARCHAR(100) NOT NULL UNIQUE,
        db_user         VARCHAR(100) NOT NULL,
        db_password_enc TEXT NOT NULL,
        host            VARCHAR(255) NOT NULL DEFAULT 'postgres',
        port            INTEGER NOT NULL DEFAULT 5432,
        status          VARCHAR(20) NOT NULL DEFAULT 'provisioning',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Cron jobs ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id          SERIAL PRIMARY KEY,
        app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        schedule    VARCHAR(100) NOT NULL,
        command     TEXT NOT NULL,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        last_run    TIMESTAMPTZ,
        next_run    TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Webhooks ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id          SERIAL PRIMARY KEY,
        app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        url         TEXT NOT NULL,
        events      TEXT[] NOT NULL DEFAULT '{}',
        secret      VARCHAR(255),
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Custom domains ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_domains (
        id          SERIAL PRIMARY KEY,
        app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        domain      VARCHAR(255) UNIQUE NOT NULL,
        verified    BOOLEAN NOT NULL DEFAULT false,
        ssl_cert    TEXT,
        ssl_key     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── App metrics (time-series légère) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_metrics (
        id          SERIAL PRIMARY KEY,
        app_id      INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        requests    INTEGER NOT NULL DEFAULT 0,
        errors      INTEGER NOT NULL DEFAULT 0,
        p95_ms      INTEGER,
        cpu_pct     NUMERIC(5,2),
        mem_mb      NUMERIC(8,2)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_metrics_app_ts ON app_metrics(app_id, ts DESC)`);

    // ── Git integrations ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS git_integrations (
        id              SERIAL PRIMARY KEY,
        app_id          INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE UNIQUE,
        provider        VARCHAR(20) NOT NULL,
        repo_url        TEXT NOT NULL,
        branch          VARCHAR(100) NOT NULL DEFAULT 'main',
        webhook_secret  VARCHAR(255),
        auto_deploy     BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Triggers updated_at ───────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql
    `);
    for (const tbl of ['users','apps','env_vars','functions']) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_${tbl}_updated_at ON ${tbl};
        CREATE TRIGGER trg_${tbl}_updated_at
        BEFORE UPDATE ON ${tbl}
        FOR EACH ROW EXECUTE FUNCTION update_updated_at()
      `);
    }

    await client.query('COMMIT');
    logger.info('Base de données V4 initialisée');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Erreur initialisation DB', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDB };
