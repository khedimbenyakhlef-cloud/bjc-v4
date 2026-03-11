#!/bin/bash
# ============================================================
# Script de migration V3 → V4
# ============================================================
set -e

echo "🔄 Migration Beny-Joe Cloud V3 → V4"
echo "======================================"

DB_URL=${DATABASE_URL:-"postgresql://beny:changeme@localhost:5432/benycloud"}

echo "📋 Étape 1: Renommage de la table 'sites' → 'apps'"
psql "$DB_URL" << 'SQL'
-- Vérifier si la migration est nécessaire
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sites') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'apps') THEN

    -- Ajouter les nouvelles colonnes à sites
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS app_type VARCHAR(30) NOT NULL DEFAULT 'static';
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS container_id VARCHAR(128);
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS container_port INTEGER;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS runtime VARCHAR(30);
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS start_command TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS build_command TEXT;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS cpu_limit VARCHAR(10) DEFAULT '0.5';
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS memory_limit VARCHAR(10) DEFAULT '256m';
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS replicas INTEGER DEFAULT 1;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS ssl_enabled BOOLEAN DEFAULT false;

    -- Migrer storage_path → storage_prefix
    ALTER TABLE sites RENAME COLUMN storage_path TO storage_prefix;

    -- Ajouter la colonne slug si elle n'existe pas
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
    UPDATE sites SET slug = regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g') WHERE slug IS NULL;
    ALTER TABLE sites ALTER COLUMN slug SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_slug_uniq ON sites(slug);

    -- Renommer la table
    ALTER TABLE sites RENAME TO apps;

    -- Migrer les déploiements (site_id → app_id)
    ALTER TABLE deployments RENAME COLUMN site_id TO app_id;

    RAISE NOTICE 'Migration V3→V4 appliquée avec succès';
  ELSE
    RAISE NOTICE 'Migration déjà appliquée ou non nécessaire';
  END IF;
END;
$$;
SQL

echo "✅ Étape 1 terminée"

echo "📋 Étape 2: Création des nouvelles tables V4"
psql "$DB_URL" << 'SQL'
CREATE TABLE IF NOT EXISTS env_vars (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL, value_enc TEXT NOT NULL, is_secret BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, key)
);

CREATE TABLE IF NOT EXISTS functions (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, slug VARCHAR(100) NOT NULL, runtime VARCHAR(30) NOT NULL DEFAULT 'nodejs18',
  code TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 10000, memory_mb INTEGER NOT NULL DEFAULT 128,
  status VARCHAR(20) DEFAULT 'active', invoke_count BIGINT DEFAULT 0, last_invoked TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(app_id, slug)
);

CREATE TABLE IF NOT EXISTS function_logs (
  id SERIAL PRIMARY KEY, function_id INTEGER NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL, duration_ms INTEGER, output TEXT, error TEXT, invoked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, schedule VARCHAR(100) NOT NULL, command TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true, last_run TIMESTAMPTZ, next_run TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_databases (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  db_type VARCHAR(20) DEFAULT 'postgres', db_name VARCHAR(100) UNIQUE NOT NULL,
  db_user VARCHAR(100) NOT NULL, db_password_enc TEXT NOT NULL,
  host VARCHAR(255) DEFAULT 'postgres', port INTEGER DEFAULT 5432,
  status VARCHAR(20) DEFAULT 'provisioning', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, url TEXT NOT NULL, events TEXT[] DEFAULT '{}',
  secret VARCHAR(255), is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_domains (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  domain VARCHAR(255) UNIQUE NOT NULL, verified BOOLEAN DEFAULT false,
  ssl_cert TEXT, ssl_key TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_metrics (
  id SERIAL PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ DEFAULT NOW(), requests INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
  p95_ms INTEGER, cpu_pct NUMERIC(5,2), mem_mb NUMERIC(8,2)
);
SQL

echo "✅ Étape 2 terminée"
echo ""
echo "✅ Migration V3 → V4 terminée avec succès !"
echo ""
echo "⚠️  Actions manuelles requises :"
echo "  1. Ajouter ENCRYPTION_KEY dans votre .env (exactement 32 caractères)"
echo "  2. Mettre à jour DOCKER_SOCKET=/var/run/docker.sock dans votre .env"
echo "  3. Redémarrer les services: docker-compose up -d --build"
