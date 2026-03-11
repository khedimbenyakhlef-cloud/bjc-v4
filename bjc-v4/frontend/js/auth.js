'use strict';

const API = '';

// ── Gestion du token OAuth dans l'URL ──────────────────────
(function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const error = params.get('error');

  if (token) {
    localStorage.setItem('bjc_token', token);
    // Nettoyer l'URL
    window.history.replaceState({}, '', '/');
    window.location.href = '/dashboard.html';
    return;
  }

  if (error) {
    showAlert('Connexion Google échouée. Réessayez.', 'error');
    window.history.replaceState({}, '', '/');
  }

  // Déjà connecté ?
  if (localStorage.getItem('bjc_token')) {
    window.location.href = '/dashboard.html';
  }
})();

function showAlert(message, type = 'error') {
  const el = document.getElementById('alert');
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function showRegister() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.remove('hidden');
}

function showLogin() {
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    return showAlert('Veuillez remplir tous les champs.');
  }

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return showAlert(data.error || 'Connexion échouée.');

    localStorage.setItem('bjc_token', data.token);
    localStorage.setItem('bjc_user', JSON.stringify(data.user));
    window.location.href = '/dashboard.html';
  } catch {
    showAlert('Erreur réseau. Vérifiez votre connexion.');
  }
}

async function register() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!email || !password) {
    return showAlert('Email et mot de passe sont requis.');
  }

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.details ? data.details.map(d => d.message).join(', ') : data.error;
      return showAlert(msg || 'Inscription échouée.');
    }

    localStorage.setItem('bjc_token', data.token);
    localStorage.setItem('bjc_user', JSON.stringify(data.user));
    window.location.href = '/dashboard.html';
  } catch {
    showAlert('Erreur réseau. Vérifiez votre connexion.');
  }
}

// Soumission via Enter
document.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const loginVisible = !document.getElementById('loginForm')?.classList.contains('hidden');
    loginVisible ? login() : register();
  }
});
