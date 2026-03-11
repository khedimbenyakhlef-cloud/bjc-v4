'use strict';

const API = '';
const token = localStorage.getItem('bjc_token');
if (!token) window.location.href = '/';

function h(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function auth() { return { Authorization: `Bearer ${token}` }; }
function logout() { localStorage.clear(); window.location.href = '/'; }

function showAlert(msg, type = 'error') {
  const el = document.getElementById('alert');
  el.textContent = msg; el.className = `alert alert-${type}`; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }

// ── Init ──────────────────────────────────────────────────────
async function init() {
  const res = await fetch(`${API}/api/auth/me`, { headers: auth() });
  if (!res.ok) return logout();
  const user = await res.json();
  document.getElementById('userName').textContent = user.name || user.email.split('@')[0];
  const av = document.getElementById('userAvatar');
  if (user.avatar_url) av.innerHTML = `<img src="${user.avatar_url}" alt="avatar">`;
  else av.textContent = (user.name || user.email)[0].toUpperCase();
  loadApps();
}

// ── Apps ──────────────────────────────────────────────────────
let apps = [];

async function loadApps() {
  const res = await fetch(`${API}/api/apps`, { headers: auth() });
  if (!res.ok) return;
  apps = await res.json();
  document.getElementById('appCount').textContent = `${apps.length} application${apps.length!==1?'s':''}`;
  renderApps();
}

function appTypeBadge(type) {
  return type === 'static'
    ? '<span class="badge badge-active">📄 Statique</span>'
    : '<span class="badge badge-pending">⚡ Full-stack</span>';
}

function statusBadge(s) {
  const m = { active:'badge-active', pending:'badge-pending', error:'badge-error', building:'badge-pending' };
  const labels = { active:'Actif', pending:'En attente', error:'Erreur', building:'Build...' };
  return `<span class="badge ${m[s]||'badge-pending'}">${labels[s]||s}</span>`;
}

function renderApps() {
  const g = document.getElementById('appsGrid');
  if (!apps.length) {
    g.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="icon">🚀</span><h3>Aucune application</h3><p>Créez votre première application et déployez-la !</p></div>`;
    return;
  }
  g.innerHTML = apps.map(a => `
    <div class="card site-card">
      <div class="site-card-header">
        <div>
          <div class="site-name">${h(a.name)}</div>
          <div class="site-domain">${h(a.domain)}</div>
          <div style="margin-top:.25rem;display:flex;gap:.35rem">${appTypeBadge(a.app_type)}${statusBadge(a.status)}</div>
        </div>
      </div>
      <div class="text-muted" style="font-size:.8125rem">
        ${a.deployment_count} déploiement${a.deployment_count!==1?'s':''} · ${a.function_count} fonction${a.function_count!==1?'s':''}
        ${a.runtime ? `· <code>${a.runtime}</code>` : ''}
      </div>
      <div class="site-card-actions" style="flex-wrap:wrap;gap:.35rem">
        <button class="btn btn-primary btn-sm" onclick="showDeployModal(${a.id},'${h(a.name)}')">🚀 Deploy</button>
        <button class="btn btn-secondary btn-sm" onclick="showEnvModal(${a.id},'${h(a.name)}')">🔑 Env</button>
        <button class="btn btn-secondary btn-sm" onclick="showFnModal(${a.id},'${h(a.name)}')">⚡ Functions</button>
        ${a.status==='active'?`<a href="/site/${h(a.slug)}/" target="_blank" class="btn btn-secondary btn-sm">🔗 Voir</a>`:''}
        ${a.app_type!=='static'&&a.status==='active'?`<button class="btn btn-secondary btn-sm" onclick="showLogs(${a.id})">📋 Logs</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="deleteApp(${a.id},'${h(a.name)}')">🗑</button>
      </div>
    </div>
  `).join('');
}

// ── Create App ────────────────────────────────────────────────
function showCreateModal() {
  document.getElementById('appName').value = '';
  document.getElementById('appType').value = 'static';
  document.getElementById('runtimeGroup').style.display = 'none';
  showModal('createModal');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('appType')?.addEventListener('change', (e) => {
    document.getElementById('runtimeGroup').style.display = e.target.value === 'fullstack' ? '' : 'none';
  });
});

async function createApp() {
  const name = document.getElementById('appName').value.trim();
  const appType = document.getElementById('appType').value;
  const runtime = appType === 'fullstack' ? document.getElementById('appRuntime').value : null;
  if (!name) return showAlert('Nom requis');
  const res = await fetch(`${API}/api/apps`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, appType, runtime }),
  });
  const data = await res.json();
  if (!res.ok) return showAlert(data.error || 'Erreur');
  hideModal('createModal');
  showAlert('Application créée !', 'success');
  loadApps();
}

// ── Deploy ────────────────────────────────────────────────────
function showDeployModal(id, name) {
  document.getElementById('deployAppId').value = id;
  document.getElementById('deployAppName').textContent = name;
  document.getElementById('zipFile').value = '';
  document.getElementById('deployProgress').classList.add('hidden');
  document.getElementById('deployBtn').disabled = false;
  document.getElementById('deployBtn').textContent = 'Déployer';
  showModal('deployModal');
}

async function deployApp() {
  const id = document.getElementById('deployAppId').value;
  const file = document.getElementById('zipFile').files[0];
  if (!file) return showAlert('Fichier ZIP requis');
  const btn = document.getElementById('deployBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  document.getElementById('deployProgress').classList.remove('hidden');
  document.getElementById('progressFill').style.width = '30%';
  const fd = new FormData();
  fd.append('zipFile', file);
  const res = await fetch(`${API}/api/apps/${id}/deploy`, { method: 'POST', headers: auth(), body: fd });
  document.getElementById('progressFill').style.width = '90%';
  const data = await res.json();
  if (!res.ok) { btn.disabled = false; btn.textContent = 'Déployer'; return showAlert(data.error || 'Erreur'); }
  setTimeout(() => { hideModal('deployModal'); showAlert('Déploiement lancé ! Le build est en cours.', 'success'); loadApps(); }, 500);
}

// ── Delete ────────────────────────────────────────────────────
async function deleteApp(id, name) {
  if (!confirm(`Supprimer "${name}" ? Irréversible.`)) return;
  const res = await fetch(`${API}/api/apps/${id}`, { method: 'DELETE', headers: auth() });
  if (!res.ok) return showAlert('Suppression échouée');
  showAlert('Application supprimée', 'success');
  loadApps();
}

// ── Env Vars ──────────────────────────────────────────────────
async function showEnvModal(id, name) {
  document.getElementById('envAppId').value = id;
  document.getElementById('envAppName').textContent = name;
  showModal('envModal');
  await refreshEnvList(id);
}

async function refreshEnvList(id) {
  const res = await fetch(`${API}/api/apps/${id}/env`, { headers: auth() });
  const vars = await res.json();
  const list = document.getElementById('envList');
  if (!vars.length) { list.innerHTML = '<p class="text-muted">Aucune variable</p>'; return; }
  list.innerHTML = vars.map(v => `
    <div style="display:flex;gap:.5rem;align-items:center;padding:.5rem;background:var(--bg);border-radius:6px;margin-bottom:.35rem">
      <code style="flex:1;font-size:.8rem">${h(v.key)}</code>
      <code style="flex:2;font-size:.8rem;color:var(--text-muted)">${h(v.value)}</code>
      ${v.is_secret ? '<span class="badge badge-pending" style="font-size:.7rem">secret</span>' : ''}
      <button class="btn btn-danger btn-sm" onclick="deleteEnvVar('${h(v.key)}')">✕</button>
    </div>
  `).join('');
}

async function addEnvVar() {
  const id = document.getElementById('envAppId').value;
  const key = document.getElementById('envKey').value.trim();
  const value = document.getElementById('envVal').value;
  const isSecret = document.getElementById('envSecret').checked;
  if (!key || !value) return showAlert('Clé et valeur requises');
  const res = await fetch(`${API}/api/apps/${id}/env`, {
    method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, isSecret }),
  });
  if (!res.ok) return showAlert('Erreur');
  document.getElementById('envKey').value = '';
  document.getElementById('envVal').value = '';
  refreshEnvList(id);
}

async function deleteEnvVar(key) {
  const id = document.getElementById('envAppId').value;
  await fetch(`${API}/api/apps/${id}/env/${key}`, { method: 'DELETE', headers: auth() });
  refreshEnvList(id);
}

// ── Functions ─────────────────────────────────────────────────
async function showFnModal(id, name) {
  document.getElementById('fnAppId').value = id;
  document.getElementById('fnAppName').textContent = name;
  showModal('fnModal');
  await refreshFnList(id);
}

async function refreshFnList(id) {
  const res = await fetch(`${API}/api/apps/${id}/functions`, { headers: auth() });
  const fns = await res.json();
  const list = document.getElementById('fnList');
  if (!fns.length) { list.innerHTML = '<p class="text-muted">Aucune fonction</p>'; return; }
  list.innerHTML = fns.map(f => `
    <div class="card" style="margin-bottom:.5rem;padding:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>${h(f.name)}</strong>
          <span class="text-muted" style="margin-left:.5rem">${h(f.runtime)}</span>
          <span class="badge badge-active" style="margin-left:.5rem">${f.invoke_count} appels</span>
        </div>
        <div style="display:flex;gap:.35rem">
          <button class="btn btn-primary btn-sm" onclick="invokeFunction('${id}','${f.id}','${h(f.name)}')">▶ Tester</button>
          <button class="btn btn-danger btn-sm" onclick="deleteFunction('${id}','${f.id}')">🗑</button>
        </div>
      </div>
      <div class="text-muted" style="font-size:.75rem;margin-top:.25rem">
        URL publique: <code>/site/${h(apps.find(a=>a.id==id)?.slug||'')}/api/${h(f.slug)}</code>
      </div>
    </div>
  `).join('');
}

async function createFunction() {
  const id = document.getElementById('fnAppId').value;
  const name = document.getElementById('fnName').value.trim();
  const runtime = document.getElementById('fnRuntime').value;
  const code = document.getElementById('fnCode').value;
  if (!name || !code) return showAlert('Nom et code requis');
  const res = await fetch(`${API}/api/apps/${id}/functions`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, runtime, code }),
  });
  const data = await res.json();
  if (!res.ok) return showAlert(data.error || 'Erreur');
  showAlert('Fonction créée !', 'success');
  refreshFnList(id);
}

async function invokeFunction(appId, fnId, name) {
  const payload = prompt(`Payload JSON pour "${name}" (laissez vide pour {}):`) || '{}';
  let event;
  try { event = JSON.parse(payload); } catch { return alert('JSON invalide'); }
  const res = await fetch(`${API}/api/apps/${appId}/functions/${fnId}/invoke`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const result = await res.json();
  alert(`Résultat (${result.durationMs}ms):\n\n${result.output || result.error}`);
}

async function deleteFunction(appId, fnId) {
  if (!confirm('Supprimer cette fonction ?')) return;
  await fetch(`${API}/api/apps/${appId}/functions/${fnId}`, { method: 'DELETE', headers: auth() });
  refreshFnList(appId);
}

// ── Logs ──────────────────────────────────────────────────────
async function showLogs(id) {
  const res = await fetch(`${API}/api/apps/${id}/logs?tail=50`, { headers: auth() });
  const data = await res.json();
  alert(data.logs || 'Pas de logs disponibles');
}

// ── Start ─────────────────────────────────────────────────────
init();
