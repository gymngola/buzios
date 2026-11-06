/**
 * Búzios — Client portal (conta)
 * Auth: email + password via Worker POST /client/auth
 */
(function () {
  'use strict';

  var WORKER = 'https://buzios-publish.gymngola.workers.dev';
  var TOKEN_KEY = 'buzios_client_token';
  var CLIENT_KEY = 'buzios_client_cache';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }
  function cacheClient(c) {
    try {
      if (c) localStorage.setItem(CLIENT_KEY, JSON.stringify(c));
      else localStorage.removeItem(CLIENT_KEY);
    } catch (_) {}
  }
  function readCachedClient() {
    try {
      var raw = localStorage.getItem(CLIENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function toast(msg) {
    var el = $('#clientToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-visible'); }, 2800);
  }

  async function api(action, payload) {
    payload = payload || {};
    payload.action = action;
    if (action === 'me' || action === 'change_password') {
      payload.token = getToken();
    }
    var res = await fetch(WORKER + '/client/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Erro de rede');
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  function daysLeft(planEnd) {
    if (!planEnd) return null;
    var end = new Date(planEnd);
    if (isNaN(end.getTime())) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.round((end - today) / 86400000);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  }

  function formatMoney(n) {
    if (n == null || n === '') return '—';
    var num = Number(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString('pt-AO') + ' Kz';
  }

  function statusBadge(status) {
    var s = String(status || '').toLowerCase();
    var label = status || '—';
    var cls = 'badge';
    if (s === 'activo' || s === 'ativo' || s === 'em_dia') cls += ' is-active';
    else if (s === 'a expirar' || s === 'pendente') cls += ' is-warn';
    else if (s === 'expirado' || s === 'suspenso' || s === 'cancelado') cls += ' is-danger';
    return '<span class="' + cls + '">' + escapeHtml(label) + '</span>';
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* ——— Views ——— */

  function showAuth() {
    $('#viewAuth').classList.remove('dash-hidden');
    $('#viewDash').classList.add('dash-hidden');
    $('#btnLogout').classList.add('dash-hidden');
  }

  function showDash() {
    $('#viewAuth').classList.add('dash-hidden');
    $('#viewDash').classList.remove('dash-hidden');
    $('#btnLogout').classList.remove('dash-hidden');
  }

  function renderClient(c) {
    if (!c) return;
    cacheClient(c);

    var avatar = $('#profileAvatar');
    if (c.photoUrl) {
      avatar.outerHTML = '<img id="profileAvatar" class="profile-avatar" src="' + escapeHtml(c.photoUrl) + '" alt="">';
    } else {
      avatar.outerHTML = '<div id="profileAvatar" class="profile-avatar placeholder" aria-hidden="true">' +
        escapeHtml(initials(c.name)) + '</div>';
    }

    $('#profileName').textContent = c.name || 'Membro';
    var sub = [];
    if (c.memberNumber) sub.push('Nº ' + c.memberNumber);
    if (c.email) sub.push(c.email);
    $('#profileSub').textContent = sub.join(' · ') || (c.phone || '');

    $('#planName').textContent = c.planName || 'Sem plano atribuído';
    var badges = $('#planBadges');
    badges.innerHTML = statusBadge(c.membershipStatus) +
      (c.billingStatus ? ' ' + statusBadge(c.billingStatus) : '');

    $('#planPrice').textContent = formatMoney(c.price);
    $('#planCycle').textContent = c.billingCycle || '—';
    $('#planStart').textContent = formatDate(c.planStart);
    $('#planEnd').textContent = formatDate(c.planEnd);

    var left = daysLeft(c.planEnd);
    var pill = $('#daysPill');
    if (left == null) {
      pill.hidden = true;
    } else {
      pill.hidden = false;
      pill.className = 'days-pill';
      if (left < 0) {
        pill.classList.add('is-danger');
        pill.textContent = 'Expirado há ' + Math.abs(left) + ' dia' + (Math.abs(left) === 1 ? '' : 's');
      } else if (left <= 7) {
        pill.classList.add('is-warn');
        pill.textContent = left === 0 ? 'Expira hoje' : (left === 1 ? 'Expira amanhã' : 'Expira em ' + left + ' dias');
      } else {
        pill.classList.add('is-ok');
        pill.textContent = left + ' dias restantes';
      }
    }

    $('#infoPhone').textContent = c.phone || '—';
    $('#infoEmail').textContent = c.email || '—';
    $('#infoArea').textContent = c.area || '—';
    $('#infoEmergency').textContent = c.emergencyName
      ? (c.emergencyName + (c.emergencyPhone ? ' · ' + c.emergencyPhone : ''))
      : '—';

    var payEl = $('#paymentsList');
    var pays = Array.isArray(c.payments) ? c.payments.slice() : [];
    if (!pays.length) {
      payEl.innerHTML = '<p class="empty-note">Nenhum pagamento registado ainda.</p>';
    } else {
      pays.sort(function (a, b) {
        return String(b.date || b.at || '').localeCompare(String(a.date || a.at || ''));
      });
      var html = '<dl class="info-list">';
      pays.slice(0, 8).forEach(function (p) {
        var label = formatDate(p.date || p.at) + (p.note ? ' · ' + p.note : '');
        var amount = p.amount != null ? formatMoney(p.amount) : (p.value != null ? formatMoney(p.value) : '—');
        html += '<div class="info-row"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(amount) + '</dd></div>';
      });
      html += '</dl>';
      payEl.innerHTML = html;
    }
  }

  /* ——— Auth forms ——— */

  function setAuthError(msg) {
    var el = $('#authError');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
  }

  function switchTab(tab) {
    $$('.auth-tab').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab);
    });
    $('#formLogin').hidden = tab !== 'login';
    $('#formRegister').hidden = tab !== 'register';
    setAuthError('');
    $('#authTitle').textContent = tab === 'login' ? 'Área do membro' : 'Criar conta';
    $('#authSub').textContent = tab === 'login'
      ? 'Entre com o email registado no clube.'
      : 'Use o mesmo email que está no seu registo de sócio.';
  }

  async function onLogin(e) {
    e.preventDefault();
    setAuthError('');
    var btn = $('#btnLogin');
    var email = $('#loginEmail').value.trim();
    var password = $('#loginPassword').value;
    btn.disabled = true;
    try {
      var data = await api('login', { email: email, password: password });
      setToken(data.token);
      renderClient(data.client);
      showDash();
      toast('Sessão iniciada');
    } catch (err) {
      setAuthError(err.message || 'Não foi possível entrar');
    } finally {
      btn.disabled = false;
    }
  }

  async function onRegister(e) {
    e.preventDefault();
    setAuthError('');
    var btn = $('#btnRegister');
    var email = $('#regEmail').value.trim();
    var password = $('#regPassword').value;
    var confirm = $('#regConfirm').value;
    if (password !== confirm) {
      setAuthError('As palavras-passe não coincidem');
      return;
    }
    btn.disabled = true;
    try {
      var data = await api('register', { email: email, password: password });
      setToken(data.token);
      renderClient(data.client);
      showDash();
      toast('Conta criada com sucesso');
    } catch (err) {
      setAuthError(err.message || 'Não foi possível criar a conta');
    } finally {
      btn.disabled = false;
    }
  }

  function logout() {
    setToken('');
    cacheClient(null);
    showAuth();
    switchTab('login');
    toast('Sessão terminada');
  }

  async function bootstrap() {
    var token = getToken();
    if (!token) {
      var cached = readCachedClient();
      if (cached) renderClient(cached);
      showAuth();
      return;
    }
    // Optimistic paint from cache
    var cached = readCachedClient();
    if (cached) {
      renderClient(cached);
      showDash();
    }
    try {
      var data = await api('me');
      renderClient(data.client);
      showDash();
    } catch (err) {
      setToken('');
      showAuth();
      if (err.status === 401) {
        /* session expired — silent */
      }
    }
  }

  function bind() {
    $$('.auth-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });
    $('#formLogin').addEventListener('submit', onLogin);
    $('#formRegister').addEventListener('submit', onRegister);
    $('#btnLogout').addEventListener('click', logout);
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    switchTab('login');
    bootstrap();
  });
})();
