'use strict';

const router = require('express').Router();
const db     = require('../config/database');
const auth   = require('../middleware/auth');

// ════════════════════════════════════════════════════════════
// ROUTE SETUP — SANS AUTH — Temporaire
// Supprimer après utilisation !
// ════════════════════════════════════════════════════════════
router.get('/setup-first-admin/:email', async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE users SET role = 'admin' WHERE email = $1 RETURNING email, role`,
      [req.params.email]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur non trouve. Inscris-toi dabord sur la plateforme.' });
    res.json({ ok: true, message: rows[0].email + ' est maintenant administrateur !' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Middleware : admin uniquement ────────────────────────────
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acces reserve aux administrateurs' });
  }
  next();
}
router.use(auth, adminOnly);

// ════════════════════════════════════════════════════════════
// GET /api/admin/stats
// ════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const [uR, aR, dR, byDay, byType, recent] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '1 day')::int AS today FROM users`),
      db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE status='error')::int AS err, COUNT(*) FILTER (WHERE status='pending')::int AS pending FROM apps`),
      db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '1 day')::int AS today FROM deployments`),
      db.query(`SELECT TO_CHAR(created_at AT TIME ZONE 'UTC','DD/MM') AS day, COUNT(*)::int AS count FROM deployments WHERE created_at >= NOW()-INTERVAL '7 days' GROUP BY day ORDER BY MIN(created_at)`),
      db.query(`SELECT app_type, COUNT(*)::int AS count FROM apps GROUP BY app_type`),
      db.query(`
        SELECT 'deploy' AS type, 'Deploiement : ' || a.name AS message, u.email AS user_email, d.created_at
        FROM deployments d JOIN apps a ON a.id = d.app_id JOIN users u ON u.id = a.user_id
        UNION ALL
        SELECT 'user', 'Inscription : ' || COALESCE(name, email), email, created_at FROM users
        ORDER BY created_at DESC LIMIT 20
      `)
    ]);
    const appsByType = {};
    byType.rows.forEach(r => { appsByType[r.app_type] = r.count; });
    res.json({
      totalUsers: uR.rows[0].total, newUsersToday: uR.rows[0].today,
      totalApps: aR.rows[0].total, activeApps: aR.rows[0].active,
      errorApps: aR.rows[0].err, pendingApps: aR.rows[0].pending,
      totalDeployments: dR.rows[0].total, deploymentsToday: dR.rows[0].today,
      deploysByDay: byDay.rows, appsByType, recentActivity: recent.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/monitoring
// ════════════════════════════════════════════════════════════
router.get('/monitoring', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT a.id, a.name, a.slug, a.domain, a.status, a.app_type, a.runtime,
             a.created_at, a.updated_at, u.email AS user_email, u.name AS user_name,
             (SELECT COUNT(*)::int FROM deployments d WHERE d.app_id = a.id) AS deployment_count
      FROM apps a JOIN users u ON u.id = a.user_id
      ORDER BY CASE a.status WHEN 'error' THEN 0 WHEN 'building' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, a.updated_at DESC
    `);
    res.json({ apps: rows, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/users
// ════════════════════════════════════════════════════════════
router.get('/users', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.email, u.name, u.role, u.plan, u.is_active, u.created_at,
             COUNT(a.id)::int AS app_count
      FROM users u LEFT JOIN apps a ON a.user_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/admin/users/:id/toggle
// ════════════════════════════════════════════════════════════
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active boolean requis' });
    const { rows } = await db.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, is_active`,
      [is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/admin/users/:id/role
// ════════════════════════════════════════════════════════════
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role invalide' });
    if (parseInt(req.params.id) === req.user.id && role !== 'admin')
      return res.status(400).json({ error: 'Impossible de vous retrograder vous-meme' });
    const { rows } = await db.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, role`,
      [role, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/apps
// ════════════════════════════════════════════════════════════
router.get('/apps', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT a.id, a.name, a.slug, a.domain, a.app_type, a.status, a.runtime, a.created_at,
             u.email AS user_email, u.name AS user_name,
             (SELECT COUNT(*)::int FROM deployments d WHERE d.app_id = a.id) AS deployment_count
      FROM apps a JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/admin/apps/:id
// ════════════════════════════════════════════════════════════
router.delete('/apps/:id', async (req, res) => {
  try {
    const { rows: [app] } = await db.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (!app) return res.status(404).json({ error: 'App introuvable' });
    await db.query('DELETE FROM apps WHERE id = $1', [req.params.id]);
    res.json({ ok: true, deleted: app.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/deployments
// ════════════════════════════════════════════════════════════
router.get('/deployments', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const { rows } = await db.query(`
      SELECT d.id, d.version_id, d.status, d.build_duration, d.created_at,
             a.name AS app_name, a.slug, u.email AS user_email
      FROM deployments d JOIN apps a ON a.id = d.app_id JOIN users u ON u.id = a.user_id
      ORDER BY d.created_at DESC LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/storage
// ════════════════════════════════════════════════════════════
router.get('/storage', async (req, res) => {
  try {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS total_deployments, COUNT(DISTINCT app_id)::int AS total_apps FROM deployments`);
    const { rows: [uR] } = await db.query(`SELECT COUNT(*) FILTER (WHERE is_active = true)::int AS active_users FROM users`);
    const { rows: topUsers } = await db.query(`
      SELECT u.email, u.name, COUNT(DISTINCT a.id)::int AS app_count,
             COUNT(d.id)::int AS deploy_count, COUNT(d.id) * 5 * 1024 * 1024 AS estimated_bytes
      FROM users u LEFT JOIN apps a ON a.user_id = u.id LEFT JOIN deployments d ON d.app_id = a.id
      GROUP BY u.id, u.email, u.name ORDER BY deploy_count DESC LIMIT 20
    `);
    res.json({
      totalBytes: (r.total_deployments || 0) * 5 * 1024 * 1024,
      totalFiles: r.total_deployments, totalApps: r.total_apps,
      activeUsers: uR.active_users, topUsers,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GET /api/admin/activity
// ════════════════════════════════════════════════════════════
router.get('/activity', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 'deploy' AS type, 'Deploiement : ' || a.name AS message, u.email AS user_email, d.created_at
      FROM deployments d JOIN apps a ON a.id = d.app_id JOIN users u ON u.id = a.user_id
      UNION ALL
      SELECT 'user', 'Inscription : ' || COALESCE(name, email), email, created_at FROM users
      UNION ALL
      SELECT 'create', 'App creee : ' || a.name, u.email, a.created_at
      FROM apps a JOIN users u ON u.id = a.user_id
      ORDER BY created_at DESC LIMIT 100
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
