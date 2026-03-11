# ☁️ Beny-Joe Cloud V4

**Plateforme PaaS multi-tenant — Sites statiques, Applications full-stack, Fonctions serverless**

---

## Nouveautés V4

| Fonctionnalité | V3 | V4 |
|---|---|---|
| Sites statiques | ✅ | ✅ |
| Apps full-stack (Node, Python, PHP) | ❌ | ✅ |
| Fonctions serverless | ❌ | ✅ |
| Variables d'environnement chiffrées | ❌ | ✅ |
| Bases de données à la demande | ❌ | ✅ |
| Tâches cron | ❌ | ✅ |
| Gestion des conteneurs Docker | ❌ | ✅ |
| Reverse proxy Traefik + SSL auto | ❌ | ✅ |
| Auto-détection du runtime | ❌ | ✅ |

---

## Architecture V4

```
Internet
   │
   ▼
Traefik (port 80/443 — SSL Let's Encrypt automatique)
   │
   ├─── /*.benyjoecloud.com → Backend Express
   │         │
   │         ├── /api/*           → API REST
   │         ├── /site/mon-app/*  → Static (MinIO) ou Proxy (Container)
   │         └── /site/mon-app/api/:fn → Fonction serverless
   │
   └─── Conteneurs des apps utilisateurs
            (réseau Docker isolé: bjc_apps)

Backend ──► PostgreSQL (données)
        ──► Redis (sessions, Bull queue)
        ──► MinIO (fichiers statiques, archives ZIP)
        ──► Docker Socket (gestion des conteneurs apps)
```

---

## Démarrage rapide (développement)

### Prérequis

- Docker Desktop ≥ 24 (avec socket Unix exposé)
- Docker Compose ≥ 2

### 1. Configuration

```bash
git clone <repo> && cd bjc-v4
cp backend/.env.example backend/.env

# Modifier .env — minimum requis :
# ENCRYPTION_KEY=exactement_32_caracteres_ici
# JWT_SECRET=<64 caractères aléatoires>
# SESSION_SECRET=<64 caractères aléatoires>
```

### 2. Lancer

```bash
docker-compose up --build -d
```

Services disponibles :
- **Frontend** → http://localhost
- **API** → http://localhost/api
- **Traefik Dashboard** → http://localhost:8080
- **Console MinIO** → http://localhost:9001

---

## Déployer un site statique

```bash
# 1. Créer un ZIP contenant votre site (avec index.html à la racine)
zip -r mon-site.zip index.html css/ js/ assets/

# 2. Créer l'app via l'API
curl -X POST http://localhost/api/apps \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"mon-site","appType":"static"}'

# 3. Déployer
curl -X POST http://localhost/api/apps/$APP_ID/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -F "zipFile=@mon-site.zip"

# ✅ Accessible sur: http://localhost/site/mon-site/
```

---

## Déployer une application full-stack

### Node.js (auto-détecté via package.json)

```bash
# Votre projet doit avoir un package.json et un fichier entry (index.js, server.js...)
# L'app doit écouter sur process.env.PORT

zip -r mon-api.zip package.json index.js src/

curl -X POST http://localhost/api/apps \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"mon-api","appType":"fullstack","runtime":"nodejs18"}'

curl -X POST http://localhost/api/apps/$APP_ID/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -F "zipFile=@mon-api.zip"

# ✅ App disponible sur: http://localhost/site/mon-api/
```

### Python (auto-détecté via requirements.txt)

```bash
# Votre app.py doit écouter sur PORT (depuis os.environ)
zip -r mon-python.zip app.py requirements.txt

curl -X POST http://localhost/api/apps \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"mon-python","appType":"fullstack","runtime":"python311"}'

# Ajouter des variables d'environnement
curl -X PUT http://localhost/api/apps/$APP_ID/env \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"DATABASE_URL","value":"postgresql://...","isSecret":true}'
```

---

## Fonctions serverless

### Créer une fonction (Node.js)

```bash
curl -X POST http://localhost/api/apps/$APP_ID/functions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ma-fonction",
    "runtime": "nodejs18",
    "code": "exports.handler = async (event, context) => { return { hello: event.name || \"world\" }; };"
  }'
```

### Invoquer via l'API

```bash
# Depuis votre code
curl -X POST http://localhost/site/mon-app/api/ma-fonction \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
# → {"hello":"Alice"}

# Ou depuis le dashboard de test
curl -X POST http://localhost/api/apps/$APP_ID/functions/$FN_ID/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
```

### Python

```python
# code de la fonction
def handler(event, context):
    name = event.get('name', 'world')
    return {'message': f'Hello {name} from Python!'}
```

---

## Bases de données à la demande

```bash
# Provisionner une base PostgreSQL dédiée
curl -X POST http://localhost/api/apps/$APP_ID/databases/provision \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dbType":"postgres"}'

# Réponse :
# {
#   "dbName": "bjc_abc123",
#   "dbUser": "u_xyz456",
#   "password": "...",
#   "connectionString": "postgresql://u_xyz456:...@postgres:5432/bjc_abc123"
# }

# Injecter automatiquement comme variable d'environnement
curl -X PUT http://localhost/api/apps/$APP_ID/env \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"DATABASE_URL","value":"postgresql://...","isSecret":true}'
```

---

## Variables d'environnement

Les variables sont **chiffrées en AES-256-CBC** en base de données.

```bash
# Ajouter/modifier
curl -X PUT http://localhost/api/apps/$APP_ID/env \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"API_KEY","value":"sk-...","isSecret":true}'

# Lister (les secrets apparaissent comme ***)
curl http://localhost/api/apps/$APP_ID/env \
  -H "Authorization: Bearer $TOKEN"

# Supprimer
curl -X DELETE http://localhost/api/apps/$APP_ID/env/API_KEY \
  -H "Authorization: Bearer $TOKEN"
```

---

## Tâches cron

```bash
curl -X POST http://localhost/api/apps/$APP_ID/crons \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "nettoyage-quotidien",
    "schedule": "0 2 * * *",
    "command": "node scripts/cleanup.js"
  }'
```

Formats valides : `*/5 * * * *` (toutes les 5 min), `0 9 * * 1-5` (9h du lundi au vendredi), etc.

---

## Domaines personnalisés et SSL

### Avec Traefik (automatique)

1. Pointer votre domaine vers l'IP du serveur (DNS A record)
2. Mettre à jour l'app :

```bash
curl -X PATCH http://localhost/api/apps/$APP_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"custom_domain":"mondomaine.com"}'
```

3. Traefik génère automatiquement le certificat Let's Encrypt

### Variables requises en production

```bash
ACME_EMAIL=votre@email.com   # Pour Let's Encrypt
BASE_DOMAIN=votredomaine.com
```

---

## Déploiement en production

```bash
# Générer les secrets
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")  # 32 chars hex
POSTGRES_PASSWORD=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
MINIO_SECRET_KEY=$(openssl rand -hex 32)

# Créer le .env de production
cat > .env.prod << EOF
POSTGRES_USER=beny
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=benycloud
REDIS_PASSWORD=$REDIS_PASSWORD
MINIO_ACCESS_KEY=bjcloud
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
JWT_SECRET=$JWT_SECRET
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
FRONTEND_URL=https://votredomaine.com
BASE_DOMAIN=votredomaine.com
ACME_EMAIL=admin@votredomaine.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://votredomaine.com/api/auth/google/callback
DEEPSEEK_API_KEY=...
EOF

docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## Migration V3 → V4

```bash
# Sauvegarder la base de données en premier !
pg_dump $OLD_DATABASE_URL > backup-v3.sql

# Exécuter le script de migration
bash scripts/migrate-v3-to-v4.sh

# Mettre à jour les variables d'environnement (ajouter ENCRYPTION_KEY, DOCKER_SOCKET)

# Rebuilder et redémarrer
docker-compose up -d --build
```

Les sites statiques existants fonctionnent **sans modification** après migration.

---

## Choix architecturaux

### Pourquoi Docker SDK (Dockerode) plutôt que Kubernetes directement ?

Pour l'hébergement self-hosted chez des clients (VPS classique), Docker est universel et simple. La migration vers Kubernetes est possible en remplaçant `containerManager.js` par des appels à l'API K8s. Les deux interfaces sont intentionnellement isolées dans un seul service.

### Pourquoi Traefik plutôt que Nginx pour la V4 ?

Traefik écoute les événements Docker et configure le routing **automatiquement** dès qu'un conteneur est créé avec les bons labels. Nginx nécessiterait une génération de config + reload à chaque déploiement. Traefik gère aussi Let's Encrypt nativement.

### Pourquoi les fonctions serverless en subprocess Node.js ?

- **Pas de cold start** : le processus Node.js est déjà lancé
- **Isolation** : `vm.Script` dans un contexte séparé sans accès aux modules système
- **Simplicité** : pas de runtime supplémentaire à gérer
- Limitation : les modules npm ne sont pas disponibles dans les fonctions (sandbox volontaire)

### Chiffrement AES-256-CBC pour les secrets

Standard éprouvé, disponible nativement dans Node.js via `crypto`. La clé est stockée uniquement dans les variables d'environnement du serveur (jamais en base). IV aléatoire à chaque chiffrement.

### Base partagée avec schemas séparés vs bases dédiées

Compromis choisi : **une base PostgreSQL par application** (user + database dédiés). Plus isolé que des schémas séparés, moins coûteux en ressources que des instances séparées. En production, possible de pointer vers un service PostgreSQL managé (RDS, Supabase, etc.).

---

## Estimation des ressources

### 10 utilisateurs actifs (5 apps, 2 full-stack)

- **VPS** : 2 vCPU, 4 Go RAM, 50 Go SSD
- **Coût estimé** : ~20-30€/mois (Hetzner, OVH)

### 100 utilisateurs (50 apps, 20 full-stack)

- **Serveur dédié** : 8 vCPU, 32 Go RAM, 200 Go SSD
- Ou 3 VPS avec Docker Swarm
- **Coût estimé** : ~100-150€/mois

### 1000 utilisateurs (500 apps, 200 full-stack)

- **Cluster Kubernetes** : 3-5 nœuds workers (4 vCPU / 16 Go chacun)
- PostgreSQL managé (RDS ou Supabase)
- MinIO cluster distribué ou S3
- **Coût estimé** : ~800-1500€/mois

---

## Conseils pour la production

1. **Sauvegardes automatiques** : `pg_dump` quotidien + réplication MinIO vers S3
2. **Monitoring** : ajouter Prometheus + Grafana (endpoint `/metrics`)
3. **Alertes** : configurer Traefik pour alerter sur les erreurs 5xx
4. **Rotation des secrets** : changer `ENCRYPTION_KEY` nécessite de re-chiffrer toutes les env vars
5. **Isolation Docker** : activer `seccomp` et `AppArmor` sur les conteneurs des apps utilisateurs
6. **Rate limiting** : ajuster les limites selon votre SLA (actuellement 200 req/15min par IP)
