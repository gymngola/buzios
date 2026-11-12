/**
 * Búzios Admin — plans, images, texts, submissions, clients
 */
(function () {
  'use strict';

  // Password lives only in Worker secret ADMIN_PASSWORD — never hardcoded here.
  // After successful login we keep the typed value in memory + sessionStorage for API calls.
  let sessionPassword = sessionStorage.getItem('buzios_admin_pw') || '';
  const PUBLISH_URL = 'https://buzios-publish.gymngola.workers.dev/publish';
  const ADMIN_DATA_URL = 'https://buzios-publish.gymngola.workers.dev/admin/data';
  const CLOUD_NAME = 'ogtzpc3v';
  const UPLOAD_PRESET = 'buzios_unsigned';
  const CATALOG_FOLDER = 'buzios';
  // Worker proxy = always fresh (avoids Cloudinary CDN 30-day cache)
  const CATALOG_JSON_URL = 'https://buzios-publish.gymngola.workers.dev/catalog';
  /** Worker /admin/data can hang on restrictive networks (e.g. gym Wi‑Fi). Never wait forever. */
  const WORKER_FETCH_MS = 12000;

  /**
   * fetch with AbortController timeout.
   * Rejects with err.name === 'AbortError' on timeout (or caller abort).
   */
  async function fetchWithTimeout(url, options, ms) {
    const timeoutMs = typeof ms === 'number' ? ms : WORKER_FETCH_MS;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const opts = Object.assign({}, options || {});
      if (ctrl) {
        if (options && options.signal) {
          // Honour both caller signal and timeout
          const onAbort = () => ctrl.abort();
          if (options.signal.aborted) ctrl.abort();
          else options.signal.addEventListener('abort', onAbort, { once: true });
        }
        opts.signal = ctrl.signal;
      }
      return await fetch(url, opts);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function isTimeoutError(err) {
    return !!(err && (err.name === 'AbortError' || /abort/i.test(String(err.message || ''))));
  }

  function getAdminPassword() {
    return sessionPassword || sessionStorage.getItem('buzios_admin_pw') || '';
  }

  function setSessionPassword(pw) {
    sessionPassword = pw || '';
    if (pw) sessionStorage.setItem('buzios_admin_pw', pw);
    else sessionStorage.removeItem('buzios_admin_pw');
  }

  const ADMIN_USERS = [
    'Julio Figueiredo',
    'Nataniel Figueiredo',
    'Keuria',
    'Garcia Kissanga',
    'Amarildo Salvador'
  ];

  function getAdminName() {
    try {
      return sessionStorage.getItem('buzios_admin_name') || localStorage.getItem('buzios_admin_name') || '';
    } catch (e) {
      return '';
    }
  }

  function getAuthEpoch() {
    try {
      const n = parseInt(sessionStorage.getItem('buzios_admin_epoch') || '0', 10);
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function setAuthEpoch(n) {
    try {
      if (n != null && n !== '') sessionStorage.setItem('buzios_admin_epoch', String(n));
      else sessionStorage.removeItem('buzios_admin_epoch');
    } catch (e) {}
  }

  /** If server auth epoch moved ahead, invalidate this browser session. */
  function checkAuthEpochFromServer(serverEpoch) {
    if (serverEpoch == null || serverEpoch === '') return;
    const remote = parseInt(serverEpoch, 10);
    if (!Number.isFinite(remote) || remote < 1) return;
    const local = getAuthEpoch();
    if (!local) {
      setAuthEpoch(remote);
      return;
    }
    if (remote > local) {
      forceRemoteLogout('Sessão terminada remotamente. Entre de novo.');
    }
  }

  function forceRemoteLogout(message) {
    stopStoreSync();
    setSessionPassword('');
    setAuthEpoch(null);
    try { sessionStorage.removeItem('buzios_admin_name'); } catch (e) {}
    sessionStorage.removeItem(LS.auth);
    localStorage.removeItem(LS.auth);
    document.documentElement.classList.remove('admin-authed');
    $('#adminApp')?.classList.add('hidden');
    $('#loginScreen')?.classList.remove('hidden');
    if ($('#loginError')) {
      $('#loginError').textContent = message || 'Sessão terminada. Entre de novo.';
      $('#loginError').style.display = 'block';
    }
    toast(message || 'Sessão terminada');
  }

  function setAdminName(name) {
    const n = String(name || '').trim();
    try {
      if (n) {
        sessionStorage.setItem('buzios_admin_name', n);
        localStorage.setItem('buzios_admin_name', n);
      } else {
        sessionStorage.removeItem('buzios_admin_name');
        localStorage.removeItem('buzios_admin_name');
      }
    } catch (e) {}
    const el = $('#adminUserLabel');
    if (el) el.textContent = n || '—';
  }

  function updateAdminUserLabel() {
    const el = $('#adminUserLabel');
    if (el) el.textContent = getAdminName() || '—';
  }
  const SITE_IMAGE_SLOTS = [
    { key: 'hero', label: 'Hero 1 (página inicial)' },
    { key: 'hero2', label: 'Hero 2 (página inicial)' },
    { key: 'intro', label: 'Secção Sobre / Intro' },
    { key: 'services', label: 'Secção “O que oferecemos” (fundo)' },
    { key: 'cta', label: 'CTA “Pronto para começar?” (início)' },
    { key: 'ginasio', label: 'Página Ginásio (hero)' },
    { key: 'ginasio_equip1', label: 'Ginásio — Equipamento (foto 1)' },
    { key: 'ginasio_equip2', label: 'Ginásio — Equipamento (foto 2)' },
    { key: 'ginasio_equip3', label: 'Ginásio — Equipamento (foto 3)' },
    { key: 'ginasio_cta', label: 'Ginásio — CTA “Marque a sua visita”' },
    { key: 'natacao', label: 'Página Natação (hero)' },
    { key: 'natacao_equip1', label: 'Natação — Instalações (foto 1)' },
    { key: 'natacao_equip2', label: 'Natação — Instalações (foto 2)' },
    { key: 'natacao_equip3', label: 'Natação — Instalações (foto 3)' },
    { key: 'natacao_cta', label: 'Natação — CTA “Inscreva-se na escola”' },
    { key: 'planos', label: 'Planos & Preços (hero)' },
    { key: 'inscricao', label: 'Inscrição (hero)' },
    { key: 'contacto', label: 'Contacto (hero)' },
    { key: 'contacto_form', label: 'Contacto — fundo do formulário' },
    { key: 'promo', label: 'Promo / banner extra' }
  ];

  const LS = {
    auth: 'buzios_admin_auth',
    products: 'buzios_products_override',
    texts: 'buzios_texts_override',
    images: 'buzios_images_override',
    media: 'buzios_media_library',
    dirty: 'buzios_draft_dirty'
  };

  let products = [];
  let texts = { pt: {}, en: {} };
  let images = {};
  let mediaLibrary = [];
  let store = { submissions: [], clients: [], newsletters: [] };
  let editingId = null;
  let editingClientId = null;
  /** Slot key waiting for a pick from the media library (or null). */
  let pendingSlotKey = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
  }

  /**
   * Styled confirm — replaces window.confirm.
   * opts: { title, confirmLabel, cancelLabel, danger }
   * @returns {Promise<boolean>}
   */
  function adminConfirm(message, opts) {
    opts = opts || {};
    const modal = $('#adminConfirmModal');
    if (!modal) return Promise.resolve(window.confirm(message));
    const titleEl = $('#adminConfirmTitle');
    const msgEl = $('#adminConfirmMsg');
    const okBtn = $('#adminConfirmOk');
    const cancelBtn = $('#adminConfirmCancel');
    if (titleEl) titleEl.textContent = opts.title || 'Confirmar';
    if (msgEl) msgEl.textContent = message || '';
    if (okBtn) {
      okBtn.textContent = opts.confirmLabel || 'Confirmar';
      okBtn.classList.toggle('is-danger', !!opts.danger);
    }
    if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
    modal.classList.add('open');
    return new Promise((resolve) => {
      function finish(val) {
        modal.classList.remove('open');
        okBtn && okBtn.removeEventListener('click', onOk);
        cancelBtn && cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onOk(e) { e.preventDefault(); finish(true); }
      function onCancel(e) { e.preventDefault(); finish(false); }
      function onBackdrop(e) { if (e.target === modal) finish(false); }
      function onKey(e) {
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter') finish(true);
      }
      okBtn && okBtn.addEventListener('click', onOk);
      cancelBtn && cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      setTimeout(() => { try { okBtn && okBtn.focus(); } catch (_) {} }, 30);
    });
  }

  /**
   * Styled single-field prompt — replaces window.prompt.
   * @returns {Promise<string|null>} null if cancelled
   */
  function adminPrompt(message, defaultValue, opts) {
    opts = opts || {};
    const modal = $('#adminPromptModal');
    if (!modal) return Promise.resolve(window.prompt(message, defaultValue));
    const titleEl = $('#adminPromptTitle');
    const msgEl = $('#adminPromptMsg');
    const input = $('#adminPromptInput');
    const okBtn = $('#adminPromptOk');
    const cancelBtn = $('#adminPromptCancel');
    if (titleEl) titleEl.textContent = opts.title || 'Editar';
    if (msgEl) {
      msgEl.textContent = message || '';
      msgEl.style.display = message ? '' : 'none';
    }
    if (input) {
      input.type = opts.inputType || 'text';
      input.value = defaultValue != null ? String(defaultValue) : '';
      input.placeholder = opts.placeholder || '';
    }
    if (okBtn) okBtn.textContent = opts.confirmLabel || 'OK';
    if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
    modal.classList.add('open');
    return new Promise((resolve) => {
      function finish(val) {
        modal.classList.remove('open');
        okBtn && okBtn.removeEventListener('click', onOk);
        cancelBtn && cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onOk(e) {
        e.preventDefault();
        finish(input ? input.value : '');
      }
      function onCancel(e) { e.preventDefault(); finish(null); }
      function onBackdrop(e) { if (e.target === modal) finish(null); }
      function onKey(e) {
        if (e.key === 'Escape') finish(null);
        if (e.key === 'Enter') finish(input ? input.value : '');
      }
      okBtn && okBtn.addEventListener('click', onOk);
      cancelBtn && cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      setTimeout(() => {
        try {
          if (input) {
            input.focus();
            input.select();
          }
        } catch (_) {}
      }, 30);
    });
  }

  // Password show/hide
  const passToggle = $('#passToggle');
  if (passToggle) {
    passToggle.addEventListener('click', () => {
      const input = $('#adminPass');
      if (input.type === 'password') {
        input.type = 'text';
        passToggle.textContent = 'Ocultar';
      } else {
        input.type = 'password';
        passToggle.textContent = 'Mostrar';
      }
    });
  }

  function checkAuth() {
    const authed =
      sessionStorage.getItem(LS.auth) === '1' ||
      localStorage.getItem(LS.auth) === '1';
    const hasPw = !!getAdminPassword();
    // Pre-fill last user on the login form
    const sel = $('#adminUser');
    if (sel) {
      const last = getAdminName() || localStorage.getItem('buzios_admin_name') || '';
      if (ADMIN_USERS.indexOf(last) >= 0) sel.value = last;
    }
    // Auth flag without password or without a selected name → force re-login
    const name = getAdminName();
    const hasName = !!(name && ADMIN_USERS.indexOf(name) >= 0);
    if (authed && hasPw && hasName) {
      if (localStorage.getItem(LS.auth) === '1' && $('#stayLoggedIn')) {
        $('#stayLoggedIn').checked = true;
      }
      setAdminName(name);
      showApp({ resume: true });
    } else if (authed && (!hasPw || !hasName)) {
      // Clear stale flag so user picks name + password again
      sessionStorage.removeItem(LS.auth);
    }
  }
  async function showApp(opts) {
    const resume = !!(opts && opts.resume);
    document.documentElement.classList.add('admin-authed');
    $('#loginScreen').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    updateAdminUserLabel();
    if (!resume) toast('A carregar catálogo…');
    await loadState();
    await loadStore();
    renderAll();
    // Panel may have been restored before store/clients existed — load live data now
    try {
      const saved = sessionStorage.getItem('buzios_admin_panel');
      if (saved && $('#panel-' + saved)) activatePanel(saved);
    } catch (e) {}
    startStoreSync();
  }

  function logoutAdmin() {
    stopStoreSync();
    setSessionPassword('');
    setAuthEpoch(null);
    // Keep last selected name in localStorage for convenience; clear session only
    try { sessionStorage.removeItem('buzios_admin_name'); } catch (e) {}
    sessionStorage.removeItem(LS.auth);
    localStorage.removeItem(LS.auth);
    document.documentElement.classList.remove('admin-authed');
    $('#adminApp').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden');
    const pass = $('#adminPass');
    if (pass) {
      pass.value = '';
      pass.focus();
    }
    if ($('#loginError')) $('#loginError').style.display = 'none';
    // Pre-select last user if still in the list
    const sel = $('#adminUser');
    if (sel) {
      const last = localStorage.getItem('buzios_admin_name') || '';
      sel.value = ADMIN_USERS.indexOf(last) >= 0 ? last : '';
    }
    toast('Sessão terminada');
  }

  async function loginWithPassword(pw) {
    const password = String(pw || '').trim();
    const adminName = ($('#adminUser') && $('#adminUser').value) || getAdminName() || '';
    const errEl = $('#loginError');
    if (!adminName || ADMIN_USERS.indexOf(adminName) < 0) {
      if (errEl) {
        errEl.textContent = 'Seleccione o seu nome';
        errEl.style.display = 'block';
      }
      return false;
    }
    if (!password) {
      if (errEl) {
        errEl.textContent = 'Introduza a palavra-passe';
        errEl.style.display = 'block';
      }
      return false;
    }
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, action: 'auth', adminName }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) {
        if (errEl) {
          errEl.textContent = 'Palavra-passe incorrecta';
          errEl.style.display = 'block';
        }
        return false;
      }
      const data = await res.json();
      if (!data || !data.ok) {
        if (errEl) {
          errEl.textContent = 'Palavra-passe incorrecta';
          errEl.style.display = 'block';
        }
        return false;
      }
      setSessionPassword(password);
      setAdminName(adminName);
      if (data.authEpoch != null) setAuthEpoch(data.authEpoch);
      const stay = $('#stayLoggedIn') && $('#stayLoggedIn').checked;
      sessionStorage.setItem(LS.auth, '1');
      if (stay) localStorage.setItem(LS.auth, '1');
      else localStorage.removeItem(LS.auth);
      if (errEl) errEl.style.display = 'none';
      showApp();
      return true;
    } catch (e) {
      console.warn('Login failed', e);
      if (errEl) {
        errEl.textContent = isTimeoutError(e)
          ? 'Servidor não respondeu. Verifique a rede (Wi‑Fi do ginásio pode bloquear a API).'
          : 'Sem ligação ao servidor. Verifique a rede e tente de novo.';
        errEl.style.display = 'block';
      }
      return false;
    }
  }

  // When staff switches back to this tab/device, pull latest immediately
  document.addEventListener('visibilitychange', () => {
    if (!$('#adminApp') || $('#adminApp').classList.contains('hidden')) return;
    if (!document.hidden) {
      // Restart interval at focus cadence and fetch now
      startStoreSync();
      refreshStoreIfChanged();
    }
  });
  window.addEventListener('focus', () => {
    if ($('#adminApp') && !$('#adminApp').classList.contains('hidden')) {
      refreshStoreIfChanged();
    }
  });
  window.addEventListener('online', () => {
    if ($('#adminApp') && !$('#adminApp').classList.contains('hidden')) {
      setSyncStatus('syncing');
      refreshStoreIfChanged();
    }
  });
  $('#loginBtn').addEventListener('click', () => {
    loginWithPassword($('#adminPass').value);
  });
  $('#adminPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginBtn').click();
  });
  const logoutBtn = $('#logoutAdminBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      logoutAdmin();
    });
  }

  $('#forceLogoutAllBtn')?.addEventListener('click', async () => {
    if (!(await adminConfirm(
      'Terminar a sessão em TODOS os dispositivos com o painel aberto?\n\nTodos (incluindo você) terão de entrar de novo.',
      { title: 'Terminar sessões', confirmLabel: 'Terminar todas', danger: true }
    ))) return;
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'force_logout_all',
          adminName: getAdminName()
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast((data && data.error) || 'Não foi possível terminar as sessões');
        return;
      }
      // Invalidate this browser immediately
      forceRemoteLogout('Todas as sessões foram terminadas. Entre de novo.');
    } catch (e) {
      toast(isTimeoutError(e) ? 'Servidor não respondeu' : 'Erro de rede');
    }
  });

  // Close modals when clicking the dimmed backdrop (not the panel itself)
  function bindModalBackdropClose(modalId) {
    const modal = $('#' + modalId);
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }
  bindModalBackdropClose('clientModal');
  bindModalBackdropClose('prodModal');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      $$('.client-row .row-more[open]').forEach(d => { d.open = false; });
    }
  });

  // Close "Mais" menus when clicking anywhere outside them
  document.addEventListener('click', (e) => {
    const openMenus = $$('.client-row .row-more[open]');
    if (!openMenus.length) return;
    openMenus.forEach(d => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  // Prevent the toggle click from immediately re-closing via the document listener
  // (details toggle happens before bubble; closing only when outside is enough)

  const PANEL_TITLES = {
    inbox: 'Inscrições',
    contacts: 'Contactos',
    newsletters: 'Newsletter',
    clients: 'Clientes',
    trainings: 'Treinos',
    products: 'Planos',
    images: 'Imagens',
    texts: 'Textos',
    audit: 'Histórico',
    guide: 'Guia'
  };

  /** Panels that edit the public website catalog (need Publish). */
  const PUBLISH_PANELS = { products: true, images: true, texts: true };

  function isPanelActive(name) {
    const panel = $('#panel-' + name);
    return !!(panel && panel.classList.contains('active'));
  }

  function activatePanel(name, opts) {
    if (!name) return;
    // skipFetch: UI-only switch (used on early reload restore before store is loaded)
    const skipFetch = !!(opts && opts.skipFetch);
    $$('.admin-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.panel === name);
    });
    $$('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('#panel-' + name);
    if (panel) panel.classList.add('active');
    const titleEl = $('#sectionTitle');
    if (titleEl) titleEl.textContent = PANEL_TITLES[name] || name;
    const publishBar = $('#publishBar');
    if (publishBar) {
      if (PUBLISH_PANELS[name]) publishBar.removeAttribute('hidden');
      else publishBar.setAttribute('hidden', '');
    }
    try {
      sessionStorage.setItem('buzios_admin_panel', name);
    } catch (e) {}
    if (skipFetch) return;
    // Live data panels: refresh when opened (clients force full D1 overlay)
    if (name === 'clients') {
      overlayClientsFromD1({ force: true });
      refreshStoreIfChanged();
    } else if (name === 'inbox' || name === 'contacts' || name === 'newsletters') {
      refreshStoreIfChanged();
    }
    // Opening Newsletter clears the "unseen" badge (no status field on rows)
    if (name === 'newsletters') {
      markNewslettersSeen();
    }
    // Trainings summary is loaded only on the Treinos panel (avoids heavy D1 reads on Clientes).
    if (name === 'trainings') {
      refreshStoreIfChanged();
      loadTrainingsPanel();
    }
    if (name === 'audit') {
      loadAuditLog();
    }
  }

  $$('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => activatePanel(btn.dataset.panel));
  });

  // Keep the same tab after reload (UI only — data loads after showApp/loadStore)
  try {
    const saved = sessionStorage.getItem('buzios_admin_panel');
    if (saved && $('#panel-' + saved)) activatePanel(saved, { skipFetch: true });
  } catch (e) {}

  /**
   * Source of truth:
   * 1. Defaults (products.js)
   * 2. Live catalog.json from Cloudinary (shared across browsers)
   * 3. If this browser has an unpublished draft (dirty flag), layer localStorage on top
   * After publish → clear dirty and sync local to published state.
   * Media library is always local-only.
   */
  async function loadState() {
    products = (window.DEFAULT_PRODUCTS || []).map(x => ({ ...x }));
    texts = JSON.parse(JSON.stringify(window.DEFAULT_TEXTS || { pt: {}, en: {} }));
    images = Object.assign({}, window.DEFAULT_SITE_IMAGES || {});

    try {
      mediaLibrary = JSON.parse(localStorage.getItem(LS.media) || '[]');
    } catch (e) {
      mediaLibrary = [];
    }

    let loadedRemote = false;
    try {
      const res = await fetch(CATALOG_JSON_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.products) && data.products.length) {
          products = data.products.map(x => ({ ...x }));
        }
        if (data.texts) {
          texts = JSON.parse(JSON.stringify(data.texts));
        }
        if (data.images && typeof data.images === 'object') {
          images = Object.assign({}, images, data.images);
        }
        loadedRemote = true;
      }
    } catch (e) {
      console.warn('Catalog fetch failed', e);
    }

    const hasDirtyDraft = localStorage.getItem(LS.dirty) === '1';

    if (hasDirtyDraft || !loadedRemote) {
      // Keep unpublished work in this browser
      try {
        const p = localStorage.getItem(LS.products);
        if (p) products = JSON.parse(p);
      } catch (e) {}
      try {
        const t = localStorage.getItem(LS.texts);
        if (t) texts = JSON.parse(t);
      } catch (e) {}
      try {
        const i = localStorage.getItem(LS.images);
        if (i) images = Object.assign({}, images, JSON.parse(i));
      } catch (e) {}
      if (hasDirtyDraft) {
        toast('Rascunho local neste browser (Produtos/Imagens/Textos). Publique ou ignore.');
      }
    } else {
      // Clean browser → match live catalog
      localStorage.setItem(LS.products, JSON.stringify(products));
      localStorage.setItem(LS.texts, JSON.stringify(texts));
      localStorage.setItem(LS.images, JSON.stringify(images));
    }
  }

  async function loadStoreFromCloudinaryDirect() {
    const url =
      'https://res.cloudinary.com/' +
      CLOUD_NAME +
      '/raw/upload/' +
      CATALOG_FOLDER +
      '/store.json?_=' +
      Date.now() +
      '&cb=' +
      Math.random().toString(36).slice(2, 8);
    // Timeout — a hung Cloudinary fetch used to leave admin stuck on "Em sincronização"
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (e) {
      console.warn('Cloudinary store fetch failed/timed out', e && e.message);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Multi-device + multi-tab sync. */
  let lastKnownUpdatedAt = null;
  let storeFetchInFlight = false;
  /** Last ops load failure: null | 'timeout' | 'network' — drives sync status + empty state. */
  let lastOpsLoadError = null;
  let localWriteInFlight = 0;
  let localWriteUntil = 0; // pause remote poll briefly after local write
  let storeSyncTimer = null;
  // D1 free-tier: keep polls sparse. Clients full-table read is expensive (~400 rows each).
  // Focused tab: 3 min; background: 10 min. Panel open / local write still force refresh.
  const STORE_SYNC_FOCUS_MS = 180000;
  const STORE_SYNC_HIDDEN_MS = 600000;
  const CLIENTS_OVERLAY_MIN_MS = 180000; // min gap between silent full clients overlays
  let lastClientsOverlayAt = 0;
  const LOCAL_WRITE_COOLDOWN_MS = 1800;
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('buzios-admin-store');
      syncChannel.onmessage = (ev) => {
        const msg = ev && ev.data;
        if (!msg || msg.type !== 'store' || !msg.store) return;
        // Ignore our own echoes shortly after a local write
        if (Date.now() < localWriteUntil) return;
        const remoteAt = msg.store.updatedAt || null;
        if (remoteAt && remoteAt === lastKnownUpdatedAt) return;
        applyStore(msg.store, { silent: true, source: 'tab' });
      };
    }
  } catch (e) {}

  function storeTimestamp(s) {
    if (!s || !s.updatedAt) return 0;
    const t = Date.parse(s.updatedAt);
    return Number.isFinite(t) ? t : 0;
  }

  function storeScore(s) {
    if (!s) return -1;
    return (
      (s.clients || []).length +
      (s.submissions || []).length +
      (s.newsletters || []).length
    );
  }

  /** Prefer newer updatedAt; richness only as tie-breaker. */
  function preferStoreSnapshot(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ta = storeTimestamp(a);
    const tb = storeTimestamp(b);
    if (ta !== tb) return ta > tb ? a : b;
    return storeScore(a) >= storeScore(b) ? a : b;
  }

  function setSyncStatus(kind, detail) {
    const el = $('#syncStatus');
    if (!el) return;
    el.dataset.state = kind || 'idle';
    if (kind === 'syncing') el.textContent = 'A sincronizar…';
    else if (kind === 'ok') el.textContent = detail || 'Sincronizado';
    else if (kind === 'remote') el.textContent = detail || 'Actualizado noutro dispositivo';
    else if (kind === 'error') el.textContent = detail || 'Falha de sincronização';
    else el.textContent = detail || 'Em sincronização';
  }

  function broadcastStore(next) {
    if (!syncChannel || !next) return;
    try {
      syncChannel.postMessage({ type: 'store', store: next, at: Date.now() });
    } catch (e) {}
  }

  function applyStore(next, opts) {
    const silent = opts && opts.silent;
    const source = (opts && opts.source) || 'server';
    const prevAt = lastKnownUpdatedAt;
    const nextAt = next && next.updatedAt ? next.updatedAt : null;
    const changed = !!(nextAt && nextAt !== prevAt);
    // Don't clobber a newer local view with an older remote snapshot
    if (nextAt && prevAt && storeTimestamp({ updatedAt: nextAt }) < storeTimestamp({ updatedAt: prevAt })) {
      return false;
    }
    // CRITICAL: never replace a non-empty local store with an empty remote
    // (this was the main cause of "clientes desapareceram")
    const localScore = storeScore(store);
    const nextScore = storeScore(next);
    if (localScore > 0 && nextScore <= 0) {
      console.warn('Blocked empty store overwrite', { localScore, nextScore, nextAt, prevAt });
      setSyncStatus('error', 'Servidor devolveu vazio — mantive os dados locais');
      return false;
    }
    // Prefer richer if timestamps are equal / missing
    if (localScore > nextScore && storeTimestamp(store) >= storeTimestamp(next || {})) {
      return false;
    }
    store = next || store;
    if (nextAt) lastKnownUpdatedAt = nextAt;
    renderInbox();
    renderContacts();
    renderNewsletters();
    renderClients();
    if (isPanelActive('trainings')) renderTrainingsPanel();
    if (silent && changed && prevAt) {
      const label = source === 'tab'
        ? 'Actualizado noutro separador'
        : 'Actualizado noutro dispositivo';
      toast(label);
      setSyncStatus('remote', label);
      setTimeout(() => setSyncStatus('ok', 'Sincronizado'), 2500);
    } else if (!silent) {
      setSyncStatus('ok', 'Sincronizado');
    }
    return changed;
  }

  /** Sort clients in the browser (avoids expensive SQL ORDER BY on every poll). */
  function sortClientsList(list) {
    if (!Array.isArray(list)) return [];
    return list.slice().sort((a, b) => {
      const ma = a && a.memberNumber != null ? Number(a.memberNumber) : null;
      const mb = b && b.memberNumber != null ? Number(b.memberNumber) : null;
      const aNull = ma == null || Number.isNaN(ma);
      const bNull = mb == null || Number.isNaN(mb);
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (!aNull && !bNull && ma !== mb) return ma - mb;
      return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'pt', {
        sensitivity: 'base'
      });
    });
  }

  /**
   * Overlay store.clients with D1 list (source of truth for clients).
   * @param {{ force?: boolean }} [opts] force=true bypasses the silent throttle
   *   (use after local writes and when opening the Clientes panel).
   */
  async function overlayClientsFromD1(opts) {
    if (!getAdminPassword()) return false;
    const force = !!(opts && opts.force);
    if (!force && lastClientsOverlayAt && Date.now() - lastClientsOverlayAt < CLIENTS_OVERLAY_MIN_MS) {
      return false;
    }
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getAdminPassword(), action: 'd1_get_clients' }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) {
        console.warn('D1 clients overlay HTTP', res.status);
        return false;
      }
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.clients)) return false;
      // Prefer D1 when it has data (or equal count). Never replace non-empty local with empty D1.
      if (data.clients.length === 0 && (store.clients || []).length > 0) return false;
      store.clients = sortClientsList(data.clients);
      lastClientsOverlayAt = Date.now();
      lastOpsLoadError = null;
      renderClients();
      // Treinos list depends on store.clients — refresh if that panel is open
      if (isPanelActive('trainings')) renderTrainingsPanel();
      return true;
    } catch (e) {
      console.warn('D1 clients overlay failed', e);
      lastOpsLoadError = isTimeoutError(e) ? 'timeout' : 'network';
      return false;
    }
  }

  /** Ids already known this session (null = not seeded yet → no toast on first load). */
  let knownEnrollmentIds = null;
  let knownContactIds = null;
  let knownNewsletterIds = null;
  /** Newsletter has no status field — badge uses unseen ids until staff opens the panel. */
  let unseenNewsletterIds = new Set();

  function isContactSubmission(s) {
    return !!(s && (s.type === 'contact' || (!s.type && s.message)));
  }

  /** Overlay store.submissions with D1 list (inbox + contacts). Same safety as clients. */
  async function overlaySubmissionsFromD1() {
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getAdminPassword(), action: 'd1_get_submissions' }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) {
        console.warn('D1 submissions overlay HTTP', res.status);
        return false;
      }
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.submissions)) {
        console.warn('D1 submissions overlay bad payload', data && data.error);
        return false;
      }
      if (data.submissions.length === 0 && (store.submissions || []).length > 0) return false;

      const next = data.submissions;
      store.submissions = next;

      // —— New enrollments ——
      const enrollmentIds = next
        .filter(s => s && s.type === 'enrollment' && !isInTrash(s))
        .map(s => String(s.id));
      if (knownEnrollmentIds == null) {
        knownEnrollmentIds = new Set(enrollmentIds);
      } else {
        const fresh = next.filter(s =>
          s && s.type === 'enrollment' && !isInTrash(s) && s.id != null &&
          !knownEnrollmentIds.has(String(s.id))
        );
        if (fresh.length) {
          fresh.forEach(s => knownEnrollmentIds.add(String(s.id)));
          notifyNewInboxItems('enrollment', fresh);
        }
        enrollmentIds.forEach(id => knownEnrollmentIds.add(id));
      }

      // —— New contact messages ——
      const contactIds = next
        .filter(s => isContactSubmission(s) && !isInTrash(s))
        .map(s => String(s.id));
      if (knownContactIds == null) {
        knownContactIds = new Set(contactIds);
      } else {
        const fresh = next.filter(s =>
          isContactSubmission(s) && !isInTrash(s) && s.id != null &&
          !knownContactIds.has(String(s.id))
        );
        if (fresh.length) {
          fresh.forEach(s => knownContactIds.add(String(s.id)));
          notifyNewInboxItems('contact', fresh);
        }
        contactIds.forEach(id => knownContactIds.add(id));
      }

      renderInbox();
      renderContacts();
      return true;
    } catch (e) {
      console.warn('D1 submissions overlay failed', e);
      if (!lastOpsLoadError) lastOpsLoadError = isTimeoutError(e) ? 'timeout' : 'network';
      return false;
    }
  }

  /**
   * Toast + title flash + optional OS notification for new enrollments / contacts / newsletters.
   * kind: 'enrollment' | 'contact' | 'newsletter'
   */
  function notifyNewInboxItems(kind, list) {
    if (!list || !list.length) return;
    let msg;
    let notifTitle;
    let panel;
    let tag;
    if (kind === 'enrollment') {
      const names = list.map(s => s.name || 'Sem nome');
      msg = list.length === 1
        ? 'Nova inscrição: ' + names[0]
        : list.length + ' novas inscrições: ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
      notifTitle = 'Búzios Admin — nova inscrição';
      panel = 'inbox';
      tag = 'buzios-enrollment';
    } else if (kind === 'contact') {
      const names = list.map(s => s.name || s.phone || 'Sem nome');
      msg = list.length === 1
        ? 'Novo contacto: ' + names[0]
        : list.length + ' novos contactos: ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
      notifTitle = 'Búzios Admin — novo contacto';
      panel = 'contacts';
      tag = 'buzios-contact';
    } else {
      const phones = list.map(n => n.phone || n.name || '—');
      msg = list.length === 1
        ? 'Nova newsletter: ' + phones[0]
        : list.length + ' novos na newsletter: ' + phones.slice(0, 3).join(', ') + (phones.length > 3 ? '…' : '');
      notifTitle = 'Búzios Admin — newsletter';
      panel = 'newsletters';
      tag = 'buzios-newsletter';
    }
    toast(msg);
    try {
      const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
      document.title = '(' + (list.length > 99 ? '99+' : list.length) + ') ' + base;
      clearTimeout(notifyNewInboxItems._titleTimer);
      notifyNewInboxItems._titleTimer = setTimeout(() => {
        document.title = base;
      }, 8000);
    } catch (e) { /* ignore */ }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(notifTitle, {
          body: msg,
          tag: tag,
          renotify: true
        });
        n.onclick = () => {
          try { window.focus(); } catch (e) {}
          activatePanel(panel);
          if (panel === 'inbox') {
            inboxFilter = 'novo';
            $('#inboxFilters')?.querySelectorAll('[data-inbox-filter]').forEach(b => {
              b.classList.toggle('active', b.dataset.inboxFilter === 'novo');
            });
            renderInbox();
          } else if (panel === 'contacts') {
            contactsFilter = 'novo';
            $('#contactsFilters')?.querySelectorAll('[data-contacts-filter]').forEach(b => {
              b.classList.toggle('active', b.dataset.contactsFilter === 'novo');
            });
            renderContacts();
          } else {
            renderNewsletters();
          }
          n.close();
        };
      }
    } catch (e) { /* ignore */ }
  }

  /** Overlay store.newsletters with D1 list. Same safety as clients/submissions. */
  async function overlayNewslettersFromD1() {
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getAdminPassword(), action: 'd1_get_newsletters' }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) {
        console.warn('D1 newsletters overlay HTTP', res.status);
        return false;
      }
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.newsletters)) {
        console.warn('D1 newsletters overlay bad payload', data && data.error);
        return false;
      }
      if (data.newsletters.length === 0 && (store.newsletters || []).length > 0) return false;

      const next = data.newsletters;
      store.newsletters = next;

      const ids = next.filter(n => n && n.id != null).map(n => String(n.id));
      if (knownNewsletterIds == null) {
        knownNewsletterIds = new Set(ids);
      } else {
        const fresh = next.filter(n => n && n.id != null && !knownNewsletterIds.has(String(n.id)));
        if (fresh.length) {
          fresh.forEach(n => {
            knownNewsletterIds.add(String(n.id));
            unseenNewsletterIds.add(String(n.id));
          });
          notifyNewInboxItems('newsletter', fresh);
        }
        ids.forEach(id => knownNewsletterIds.add(id));
      }

      renderNewsletters();
      return true;
    } catch (e) {
      console.warn('D1 newsletters overlay failed', e);
      if (!lastOpsLoadError) lastOpsLoadError = isTimeoutError(e) ? 'timeout' : 'network';
      return false;
    }
  }

  async function loadStore(opts) {
    const silent = !!(opts && opts.silent);
    const workerOnly = !!(opts && opts.workerOnly);
    if (storeFetchInFlight) return false;
    storeFetchInFlight = true;
    if (!silent) setSyncStatus('syncing');
    lastOpsLoadError = null;
    try {
      // No password → cannot call Worker; still try D1 overlays only if we somehow have one
      if (!getAdminPassword()) {
        if (!silent) setSyncStatus('error', 'Sessão sem password — volte a entrar');
        return false;
      }

      let fromWorker = null;
      let workerReachable = false;
      try {
        const res = await fetchWithTimeout(ADMIN_DATA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: getAdminPassword(), action: 'get' }),
          cache: 'no-store'
        }, WORKER_FETCH_MS);
        workerReachable = true;
        if (res.status === 401) {
          setSessionPassword('');
          sessionStorage.removeItem(LS.auth);
          if (!silent) setSyncStatus('error', 'Não autorizado');
          return false;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.authEpoch != null) checkAuthEpochFromServer(data.authEpoch);
          if (data.store) fromWorker = data.store;
        }
      } catch (e) {
        console.warn('Store load (worker) failed', e);
        lastOpsLoadError = isTimeoutError(e) ? 'timeout' : 'network';
      }

      let chosen = fromWorker;
      // Initial load may also consult Cloudinary; silent polls use worker only
      // to avoid CDN-stale snapshots overwriting fresher worker data.
      if (!workerOnly && !silent) {
        let fromCloud = null;
        try {
          fromCloud = await loadStoreFromCloudinaryDirect();
        } catch (e) {
          console.warn('Store load (cloudinary) failed', e);
        }
        chosen = preferStoreSnapshot(fromWorker, fromCloud);
      }

      // After cutover, operational data lives in D1. Even if store snapshot is
      // missing/empty, still overlay from D1 so Clientes/Inscrições appear.
      // Clients full-list is throttled on silent polls (see CLIENTS_OVERLAY_MIN_MS).
      const forceClients = !silent;
      if (chosen) {
        if (silent && chosen.updatedAt && chosen.updatedAt === lastKnownUpdatedAt) {
          await overlayClientsFromD1({ force: forceClients });
          await overlaySubmissionsFromD1();
          await overlayNewslettersFromD1();
          if (lastOpsLoadError && !(store.clients || []).length) {
            setSyncStatus(
              'error',
              lastOpsLoadError === 'timeout'
                ? 'Servidor não respondeu (tempo esgotado)'
                : 'Sem ligação ao servidor'
            );
          } else {
            setSyncStatus('ok', 'Sincronizado');
          }
          return false;
        }
        applyStore(chosen, { silent: silent && !!lastKnownUpdatedAt });
      }

      const gotClients = await overlayClientsFromD1({ force: forceClients });
      await overlaySubmissionsFromD1();
      await overlayNewslettersFromD1();

      if (!chosen && !gotClients && !(store.clients || []).length) {
        if (!silent) {
          if (lastOpsLoadError === 'timeout') {
            setSyncStatus('error', 'Servidor não respondeu (tempo esgotado)');
          } else if (lastOpsLoadError === 'network' || !workerReachable) {
            setSyncStatus('error', 'Sem ligação ao servidor');
          } else {
            setSyncStatus('error', 'Sem dados do servidor');
          }
        }
        renderClients();
        return false;
      }

      if (gotClients || (store.clients || []).length) {
        setSyncStatus('ok', 'Sincronizado');
      } else if (lastOpsLoadError) {
        setSyncStatus(
          'error',
          lastOpsLoadError === 'timeout'
            ? 'Servidor não respondeu (tempo esgotado)'
            : 'Sem ligação ao servidor'
        );
      } else {
        setSyncStatus('ok', 'Sincronizado');
      }
      return !!chosen;
    } catch (e) {
      console.warn('loadStore failed', e);
      if (!silent) {
        setSyncStatus(
          'error',
          isTimeoutError(e) ? 'Servidor não respondeu (tempo esgotado)' : 'Erro ao sincronizar'
        );
      }
      return false;
    } finally {
      storeFetchInFlight = false;
    }
  }

  async function refreshStoreIfChanged() {
    // Background tabs use the long interval only; skip if a fetch is already running.
    if (storeFetchInFlight) return;
    if (Date.now() < localWriteUntil) return;
    await loadStore({ silent: true, workerOnly: true });
  }

  const AUDIT_ACTION_LABELS = {
    save_client: 'Guardou cliente',
    save_submission: 'Guardou inscrição/contacto',
    trash_client: 'Lixeira (cliente)',
    restore_client: 'Restaurou cliente',
    archive_client: 'Arquivou cliente',
    delete_client: 'Apagou cliente',
    trash_submission: 'Lixeira (inscrição)',
    restore_submission: 'Restaurou inscrição',
    delete_submission: 'Apagou inscrição',
    purge_trash: 'Limpeza lixeira',
    d1_backup: 'Backup D1',
    d1_import: 'Importação D1'
  };

  /** Angola (WAT = UTC+1, no DST). Force this zone so gym devices with wrong system TZ still show correct local times. */
  const AO_TZ = 'Africa/Luanda';
  const AO_OFFSET = '+01:00';

  /** Full date+time in Angola, e.g. "12/11/2026, 10:05". */
  function formatDateTimeAO(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 16);
      return d.toLocaleString('pt-AO', {
        timeZone: AO_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      return String(iso).slice(0, 16);
    }
  }

  /** Time only in Angola, e.g. "10:05". */
  function formatTimeAO(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('pt-AO', {
        timeZone: AO_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      return '';
    }
  }

  /** Short audit style: "12/11 10:05" in Angola time. */
  function formatAuditWhen(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 16);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: AO_TZ,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(d);
      const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
      return get('day') + '/' + get('month') + ' ' + get('hour') + ':' + get('minute');
    } catch (e) {
      return String(iso).slice(0, 16);
    }
  }

  function renderAuditLog(entries) {
    const box = $('#auditList');
    if (!box) return;
    if (!entries || !entries.length) {
      box.innerHTML = '<p class="empty-hint" style="color:#888;font-size:0.9rem">Ainda não há registos. As acções de guardar, arquivar e apagar passam a aparecer aqui.</p>';
      return;
    }
    const rows = entries.map(function (e) {
      const label = AUDIT_ACTION_LABELS[e.action] || e.action || '—';
      const entity = e.entity ? String(e.entity) : '';
      const idShort = e.entity_id ? String(e.entity_id).slice(0, 12) : '';
      const detail = e.detail ? String(e.detail) : '';
      const meta = [entity, idShort].filter(Boolean).join(' · ');
      return (
        '<div class="audit-row">' +
          '<span class="audit-when">' + formatAuditWhen(e.at) + '</span>' +
          '<span class="audit-action">' + label + '</span>' +
          (meta ? '<span class="audit-meta">' + meta + '</span>' : '') +
          (detail ? '<span class="audit-detail">' + detail + '</span>' : '') +
        '</div>'
      );
    }).join('');
    box.innerHTML = rows;
  }

  async function loadAuditLog() {
    const box = $('#auditList');
    if (box) box.innerHTML = '<p class="empty-hint" style="color:#888;font-size:0.9rem">A carregar…</p>';
    const password = getAdminPassword();
    if (!password) {
      if (box) box.innerHTML = '<p class="empty-hint" style="color:#b33;font-size:0.9rem">Sessão inválida. Volte a entrar.</p>';
      return;
    }
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password, action: 'get_audit_log', data: { limit: 200 } }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || 'Falha');
      renderAuditLog(data.entries || []);
    } catch (err) {
      console.warn('audit log', err);
      if (box) {
        box.innerHTML = '<p class="empty-hint" style="color:#b33;font-size:0.9rem">Não foi possível carregar o histórico' +
          (isTimeoutError(err) ? ' (timeout de rede).' : '.') + '</p>';
      }
    }
  }

  function currentSyncInterval() {
    return document.hidden ? STORE_SYNC_HIDDEN_MS : STORE_SYNC_FOCUS_MS;
  }

  function startStoreSync() {
    stopStoreSync();
    const tick = async () => {
      await refreshStoreIfChanged();
      storeSyncTimer = setTimeout(tick, currentSyncInterval());
    };
    storeSyncTimer = setTimeout(tick, currentSyncInterval());
    setSyncStatus('ok', 'Sincronizado');
  }

  function stopStoreSync() {
    if (storeSyncTimer) {
      clearTimeout(storeSyncTimer);
      storeSyncTimer = null;
    }
  }

  /** Auto-save catalog edits to this browser (no manual “Guardar rascunho”). */
  function markDirty() {
    try {
      localStorage.setItem(LS.products, JSON.stringify(products));
      localStorage.setItem(LS.texts, JSON.stringify(texts));
      localStorage.setItem(LS.images, JSON.stringify(images));
      localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
      localStorage.setItem(LS.dirty, '1');
    } catch (e) {}
  }

  /** After publish: local matches live catalog; clear dirty so other browsers stay in sync. */
  function syncLocalFromState() {
    localStorage.setItem(LS.products, JSON.stringify(products));
    localStorage.setItem(LS.texts, JSON.stringify(texts));
    localStorage.setItem(LS.images, JSON.stringify(images));
    localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
    localStorage.removeItem(LS.dirty);
  }

  // —— Inbox (enrollments only) ——
  let inboxFilter = 'all';
  const SUB_STATUS_LABEL = {
    novo: 'novo',
    contactado: 'contactado',
    pendente_docs: 'aguarda docs',
    inscrito: 'inscrito',
    arquivado: 'arquivado'
  };
  const SUB_STATUS_ORDER = { novo: 0, contactado: 1, pendente_docs: 2, inscrito: 3, arquivado: 4 };

  /** Resolve the client linked to a submission (null if none or permanently purged). */
  function linkedClientForSubmission(s) {
    if (!s || !s.fromClientId) return null;
    return (store.clients || []).find(c => String(c.id) === String(s.fromClientId)) || null;
  }

  function enrollmentActionButtons(s) {
    const status = s.status || 'novo';
    const id = s.id;
    const btns = [];
    // Always allow moving to any operational status (reversible)
    if (status !== 'novo') {
      btns.push(`<button type="button" data-st="${id}" data-v="novo">Reabrir (novo)</button>`);
    }
    if (status !== 'contactado') {
      btns.push(`<button type="button" data-st="${id}" data-v="contactado">Contactado</button>`);
    }
    if (status !== 'pendente_docs') {
      btns.push(`<button type="button" data-st="${id}" data-v="pendente_docs">Aguarda docs</button>`);
    }
    if (status !== 'inscrito') {
      btns.push(`<button type="button" data-st="${id}" data-v="inscrito">Inscrito</button>`);
    }
    // Create / open / restore client
    // - Linked + in trash → Restaurar cliente + Ver cliente
    // - Linked + active   → Ver cliente
    // - No link or permanently purged → Criar cliente
    const linked = linkedClientForSubmission(s);
    if (linked && isInTrash(linked)) {
      btns.push(`<button type="button" data-restore-cli-from-sub="${escapeHtml(linked.id)}">Restaurar cliente</button>`);
      btns.push(`<button type="button" data-open-cli="${escapeHtml(linked.id)}">Ver cliente</button>`);
    } else if (linked) {
      btns.push(`<button type="button" data-open-cli="${escapeHtml(linked.id)}">Ver cliente</button>`);
    } else {
      btns.push(`<button type="button" data-promote-cli="${id}">Criar cliente</button>`);
      btns.push(`<button type="button" data-promote-cli-pend="${id}">Criar pendente (docs)</button>`);
    }
    if (isInTrash(s)) {
      btns.push(`<button type="button" data-restore-sub="${id}">Restaurar</button>`);
      btns.push(`<button type="button" class="danger" data-del-sub="${id}" data-purge="1">Apagar já</button>`);
      return btns.join('');
    }
    if (status !== 'arquivado') {
      btns.push(`<button type="button" data-st="${id}" data-v="arquivado">Arquivar</button>`);
    }
    btns.push(`<button type="button" class="danger" data-del-sub="${id}">Lixeira</button>`);
    return btns.join('');
  }

  function countNewEnrollments() {
    return (store.submissions || []).filter(
      s => s.type === 'enrollment' && !isInTrash(s) && (s.status || 'novo') === 'novo'
    ).length;
  }

  function updateInboxNavBadge() {
    const btn = document.querySelector('.admin-tabs button[data-panel="inbox"]');
    if (!btn) return;
    let badge = btn.querySelector('.nav-badge');
    const n = countNewEnrollments();
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
      badge.title = n === 1 ? '1 inscrição nova' : n + ' inscrições novas';
    } else if (badge) {
      badge.style.display = 'none';
      badge.title = '';
    }
    // Mirror count on the "Novos" filter chip
    const novoBtn = $('#inboxFilters')?.querySelector('[data-inbox-filter="novo"]');
    if (novoBtn) {
      novoBtn.textContent = n > 0 ? ('Novos (' + n + ')') : 'Novos';
    }
  }

  function renderInbox() {
    const list = $('#inboxList');
    if (!list) return;
    updateInboxNavBadge();
    let items = (store.submissions || []).filter(s => s.type === 'enrollment');
    if (inboxFilter === 'lixeira') {
      items = items.filter(isInTrash);
    } else {
      items = items.filter(s => !isInTrash(s));
      if (inboxFilter && inboxFilter !== 'all') {
        items = items.filter(s => (s.status || 'novo') === inboxFilter);
      }
    }
    items = items.slice().sort((a, b) => {
      const sa = SUB_STATUS_ORDER[a.status || 'novo'] ?? 9;
      const sb = SUB_STATUS_ORDER[b.status || 'novo'] ?? 9;
      if (sa !== sb) return sa - sb;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">' +
        (inboxFilter && inboxFilter !== 'all'
          ? 'Nenhuma inscrição neste filtro.'
          : 'Nenhuma inscrição ainda. Aparecem quando alguém preenche o formulário de inscrição.') +
        '</p>';
      // Keep selection in memory; only the visible list is empty for this filter
      updateBulkBar('inbox');
      return;
    }
    list.innerHTML = items.map(s => {
      const status = s.status || 'novo';
      const statusLabel = SUB_STATUS_LABEL[status] || status;
      const when = s.createdAt ? formatDateTimeAO(s.createdAt) : '';
      const schedule = Array.isArray(s.schedule) && s.schedule.length
        ? '<div class="meta">Horário: ' + s.schedule.join(', ') + '</div>'
        : '';
      return `
        <div class="prod-card">
          <label class="card-check"><input type="checkbox" class="bulk-item" data-list="inbox" data-id="${escapeHtml(s.id)}"></label>
          <h3>${escapeHtml(s.name || '—')} <span class="status-badge status-${status}">${escapeHtml(statusLabel)}</span></h3>
          <div class="meta">Inscrição · ${escapeHtml(s.phone || '')} · ${when}</div>
          <div class="meta" style="margin-top:0.35rem">
            ${s.area ? 'Área: ' + escapeHtml(formatAreaLabel(s.area)) + (s.planName || s.planId ? ' · ' : '') : ''}
            ${escapeHtml(s.planName || friendlyPlanName(s.planId) || s.planId || '')}
          </div>
          ${s.planIdGym || s.planIdSwim
            ? '<div class="meta">' +
              (s.planIdGym ? 'Ginásio: ' + escapeHtml(friendlyPlanName(s.planIdGym) || s.planIdGym) : '') +
              (s.planIdGym && s.planIdSwim ? ' · ' : '') +
              (s.planIdSwim ? 'Natação: ' + escapeHtml(friendlyPlanName(s.planIdSwim) || s.planIdSwim) : '') +
              '</div>'
            : ''}
          ${renderEnrollmentLines(s)}
          ${s.annualFee ? '<div class="meta">Inscrição anual ginásio: sim</div>' : ''}
          ${s.extras && s.extras.length ? '<div class="meta">Extras: ' + escapeHtml(s.extras.map(id => friendlyPlanName(id) || id).join(', ')) + '</div>' : ''}
          ${s.estimatedTotal != null ? '<div class="meta"><strong>Total estimado:</strong> ' + Number(s.estimatedTotal).toLocaleString('pt') + ' Kz</div>' : ''}
          ${s.birthDate
            ? '<div class="meta">Nascimento: ' + escapeHtml(formatDatePT(s.birthDate)) + (s.age != null ? ' · Idade ' + escapeHtml(String(s.age)) : '') + '</div>'
            : (s.age ? '<div class="meta">Idade: ' + escapeHtml(String(s.age)) + '</div>' : '')}
          ${s.email ? '<div class="meta">Email: ' + escapeHtml(s.email) + '</div>' : ''}
          ${s.emergencyName || s.emergencyPhone
            ? '<div class="meta">Emergência: ' + escapeHtml([s.emergencyName, s.emergencyPhone].filter(Boolean).join(' — ')) + '</div>'
            : (s.emergency ? '<div class="meta">Emergência: ' + escapeHtml(s.emergency) + '</div>' : '')}
          ${s.goals ? '<div class="meta"><strong>Objectivos de treino:</strong> ' + escapeHtml(s.goals) + '</div>' : ''}
          ${s.medicalConditions ? '<div class="meta"><strong>Condições médicas:</strong> ' + escapeHtml(s.medicalConditions) + '</div>' : ''}
          ${schedule}
          ${s.notes ? '<div class="meta"><strong>Notas ou questões:</strong> ' + escapeHtml(s.notes) + '</div>' : ''}
          ${s.docsLater ? '<div class="meta">Documentos: a entregar no local</div>' : ''}
          ${renderAttachmentGallery(s)}
          ${(() => {
            if (!s.fromClientId) return '';
            const linked = linkedClientForSubmission(s);
            if (linked && isInTrash(linked)) {
              return '<div class="meta" style="color:#b45309">Cliente ligado (na lixeira): <code>' +
                escapeHtml(s.fromClientId) + '</code> — use <strong>Restaurar cliente</strong></div>';
            }
            if (linked) {
              return '<div class="meta">Cliente ligado: <code>' + escapeHtml(s.fromClientId) + '</code></div>';
            }
            // Link points at a permanently purged client
            return '<div class="meta" style="color:#888">Cliente ligado foi apagado em definitivo — pode criar um novo</div>';
          })()}
          <div class="actions" style="margin-top:0.65rem">
            ${enrollmentActionButtons(s)}
          </div>
        </div>`;
    }).join('');

    bindSubmissionActions(list);
    list.querySelectorAll('[data-promote-cli]').forEach(btn => {
      btn.addEventListener('click', () => promoteSubmissionToClient(btn.dataset.promoteCli, { asPending: false }));
    });
    list.querySelectorAll('[data-promote-cli-pend]').forEach(btn => {
      btn.addEventListener('click', () => promoteSubmissionToClient(btn.dataset.promoteCliPend, { asPending: true }));
    });
    list.querySelectorAll('[data-restore-cli-from-sub]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.restoreCliFromSub;
        if (!cid) return;
        const existing = (store.clients || []).find(c => String(c.id) === String(cid));
        if (!existing) return toast('Cliente não encontrado (pode ter sido apagado em definitivo)');
        if (!isInTrash(existing)) {
          toast('Cliente já não está na lixeira');
          activatePanel('clients');
          openClientModal(cid);
          return;
        }
        btn.disabled = true;
        const ok = await adminAction('restore_client', { id: cid });
        if (ok) {
          toast('Cliente restaurado');
          activatePanel('clients');
          // Leave filter on "all" so the restored client is visible
          if (clientsFilter === 'lixeira') {
            clientsFilter = 'all';
            $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(b => {
              b.classList.toggle('active', b.dataset.filter === 'all');
            });
            renderClients();
          }
          openClientModal(cid);
        } else {
          btn.disabled = false;
          toast('Não foi possível restaurar o cliente');
        }
      });
    });
    list.querySelectorAll('[data-open-cli]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.openCli;
        const c = (store.clients || []).find(x => String(x.id) === String(cid));
        activatePanel('clients');
        if (c && isInTrash(c)) {
          clientsFilter = 'lixeira';
          $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === 'lixeira');
          });
          renderClients();
          if (typeof syncClientsBulkActionsForFilter === 'function') syncClientsBulkActionsForFilter();
        }
        openClientModal(cid);
      });
    });
    bindBulkItemChecks('inbox');
    restoreBulkSelection('inbox');
    updateBulkBar('inbox');
  }

  // —— Contact form messages ——
  let contactsFilter = 'all';
  const CONTACT_STATUS_LABEL = {
    novo: 'novo',
    contactado: 'respondido',
    respondido: 'respondido',
    arquivado: 'arquivado'
  };
  const CONTACT_STATUS_ORDER = { novo: 0, contactado: 1, respondido: 1, arquivado: 2 };

  function contactActionButtons(s) {
    const id = escapeHtml(s.id);
    const status = s.status || 'novo';
    const btns = [];
    if (isInTrash(s)) {
      btns.push(`<button type="button" data-restore-sub="${id}">Restaurar</button>`);
      btns.push(`<button type="button" class="danger" data-del-sub="${id}" data-purge="1">Apagar já</button>`);
      return btns.join('');
    }
    if (status !== 'novo') {
      btns.push(`<button type="button" data-st="${id}" data-v="novo">Reabrir (novo)</button>`);
    }
    if (status !== 'contactado' && status !== 'respondido') {
      btns.push(`<button type="button" data-st="${id}" data-v="contactado">Respondido</button>`);
    }
    if (status !== 'arquivado') {
      btns.push(`<button type="button" data-st="${id}" data-v="arquivado">Arquivar</button>`);
    }
    const wa = whatsappUrl(s.phone);
    if (wa) {
      btns.push(`<a class="wa-btn" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>`);
    }
    btns.push(`<button type="button" class="danger" data-del-sub="${id}">Lixeira</button>`);
    return btns.join('');
  }

  function countNewContacts() {
    return (store.submissions || []).filter(
      s => isContactSubmission(s) && !isInTrash(s) && (s.status || 'novo') === 'novo'
    ).length;
  }

  function updateContactsNavBadge() {
    const btn = document.querySelector('.admin-tabs button[data-panel="contacts"]');
    if (!btn) return;
    let badge = btn.querySelector('.nav-badge');
    const n = countNewContacts();
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
      badge.title = n === 1 ? '1 contacto novo' : n + ' contactos novos';
    } else if (badge) {
      badge.style.display = 'none';
      badge.title = '';
    }
    const novoBtn = $('#contactsFilters')?.querySelector('[data-contacts-filter="novo"]');
    if (novoBtn) {
      novoBtn.textContent = n > 0 ? ('Novos (' + n + ')') : 'Novos';
    }
  }

  function renderContacts() {
    const list = $('#contactsList');
    if (!list) return;
    updateContactsNavBadge();
    let items = (store.submissions || []).filter(s => isContactSubmission(s));
    if (contactsFilter === 'lixeira') {
      items = items.filter(isInTrash);
    } else {
      items = items.filter(s => !isInTrash(s));
      if (contactsFilter && contactsFilter !== 'all') {
        if (contactsFilter === 'contactado') {
          items = items.filter(s => {
            const st = s.status || 'novo';
            return st === 'contactado' || st === 'respondido';
          });
        } else {
          items = items.filter(s => (s.status || 'novo') === contactsFilter);
        }
      }
    }
    items = items.slice().sort((a, b) => {
      const sa = CONTACT_STATUS_ORDER[a.status || 'novo'] ?? 9;
      const sb = CONTACT_STATUS_ORDER[b.status || 'novo'] ?? 9;
      if (sa !== sb) return sa - sb;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">' +
        (contactsFilter && contactsFilter !== 'all'
          ? 'Nenhuma mensagem neste filtro.'
          : 'Nenhuma mensagem de contacto ainda. Aparecem quando alguém envia o formulário na página Contacto.') +
        '</p>';
      updateBulkBar('contacts');
      return;
    }
    list.innerHTML = items.map(s => {
      const status = s.status || 'novo';
      const statusLabel = CONTACT_STATUS_LABEL[status] || status;
      const badgeClass = (status === 'respondido') ? 'contactado' : status;
      const when = s.createdAt ? formatDateTimeAO(s.createdAt) : '';
      const msg = s.message || s.notes || '';
      return `
        <div class="prod-card">
          <label class="card-check"><input type="checkbox" class="bulk-item" data-list="contacts" data-id="${escapeHtml(s.id)}"></label>
          <h3>${escapeHtml(s.name || '—')} <span class="status-badge status-${badgeClass}">${escapeHtml(statusLabel)}</span></h3>
          <div class="meta">Contacto · ${escapeHtml(s.phone || '')} · ${when}</div>
          <div class="meta" style="margin-top:0.35rem">
            ${s.subject ? 'Assunto: ' + escapeHtml(s.subject) : ''}
            ${s.preferContact ? ' · Preferência: ' + escapeHtml(s.preferContact) : ''}
            ${s.email ? ' · ' + escapeHtml(s.email) : ''}
          </div>
          ${msg ? '<p style="font-size:0.85rem;margin:0.5rem 0;color:#444;white-space:pre-wrap">' + escapeHtml(msg) + '</p>' : ''}
          <div class="actions" style="margin-top:0.65rem">
            ${contactActionButtons(s)}
          </div>
        </div>`;
    }).join('');

    bindSubmissionActions(list);
    bindBulkItemChecks('contacts');
    restoreBulkSelection('contacts');
    updateBulkBar('contacts');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** PDFs stored under /image/upload/ return 401; serve them via /raw/upload/ */
  function fixAttachmentUrl(url) {
    if (!url) return '';
    if (typeof url === 'object') url = url.url || '';
    if (typeof url !== 'string') return '';
    if (/\.pdf($|\?)/i.test(url) && url.includes('/image/upload/')) {
      return url.replace('/image/upload/', '/raw/upload/');
    }
    return url;
  }

  const DOC_KEY_LABELS = {
    id: 'BI / Cédula / Passaporte',
    medicalCert: 'Atestado médico',
    photo1: 'Foto 1',
    photo2: 'Foto 2',
    paymentProof: 'Comprovativo de pagamento',
    doc: 'Documento'
  };

  /** Standard slots in the client modal — same types as inscrição + comprovativo. */
  const CLIENT_DOC_SLOTS = [
    { key: 'id', label: 'BI / Cédula / Passaporte', short: 'BI / Cédula', accept: 'image/*,.pdf,application/pdf', hint: 'Imagem ou PDF' },
    { key: 'medicalCert', label: 'Atestado médico', short: 'Atestado', accept: 'image/*,.pdf,application/pdf', hint: 'Imagem ou PDF' },
    { key: 'photo1', label: 'Foto 1 (tipo passe)', short: 'Foto 1', accept: 'image/*', hint: 'Só imagem' },
    { key: 'photo2', label: 'Foto 2 (tipo passe)', short: 'Foto 2', accept: 'image/*', hint: 'Só imagem' },
    { key: 'paymentProof', label: 'Comprovativo de pagamento', short: 'Pagamento', accept: 'image/*,.pdf,application/pdf', hint: 'Imagem ou PDF' }
  ];

  function shortDocLabel(a) {
    if (!a) return 'Doc';
    if (a.key && DOC_KEY_LABELS[a.key]) {
      // Compact chip labels for the list view
      if (a.key === 'id') return 'BI / Cédula';
      if (a.key === 'medicalCert') return 'Atestado';
      if (a.key === 'paymentProof') return 'Pagamento';
      return DOC_KEY_LABELS[a.key];
    }
    const lab = String(a.label || '').trim();
    if (/bi|c[eé]dula|passaporte/i.test(lab)) return 'BI / Cédula';
    if (/atestado|m[eé]dic/i.test(lab)) return 'Atestado';
    if (/foto.*1|passe\s*1/i.test(lab)) return 'Foto 1';
    if (/foto.*2|passe\s*2/i.test(lab)) return 'Foto 2';
    if (/comprova|pagament|recibo/i.test(lab)) return 'Pagamento';
    if (/foto|photo|passe/i.test(lab)) return 'Foto';
    return lab ? (lab.length > 18 ? lab.slice(0, 16) + '…' : lab) : 'Documento';
  }

  /** Resolve attachment for a standard slot key (documents object or attachments list). */
  function findDocByKey(items, key) {
    if (!key || !items || !items.length) return null;
    const byKey = items.find(a => a && a.key === key);
    if (byKey) return byKey;
    // Heuristic fallback for legacy unlabeled uploads
    return items.find(a => {
      const lab = String((a && (a.label || a.name)) || '');
      if (key === 'id') return /bi|c[eé]dula|passaporte/i.test(lab);
      if (key === 'medicalCert') return /atestado|m[eé]dic/i.test(lab);
      if (key === 'photo1') return /foto.*1|passe\s*1/i.test(lab);
      if (key === 'photo2') return /foto.*2|passe\s*2/i.test(lab);
      if (key === 'paymentProof') return /comprova|pagament|recibo/i.test(lab);
      return false;
    }) || null;
  }

  /**
   * Refresh only photo + documents in the open client modal.
   * Does NOT re-fill form fields — preserves in-progress edits above.
   */
  function refreshClientMediaUI(opts) {
    if (!editingClientId) return;
    const c = (store.clients || []).find(x => x.id === editingClientId);
    if (!c) return;
    const docsHost = $('#cDocsHost');
    if (docsHost) {
      docsHost.innerHTML = renderClientDocsBlock(c);
      bindClientDocsActions();
    }
    renderClientPhoto(c);
    if (opts && opts.keepDocsOpen) {
      const docsSec = document.querySelector('#clientModal [data-section="docs"]');
      if (docsSec) setClientSectionOpen(docsSec, true);
    }
  }

  /**
   * Prefer enrollment "Foto tipo passe" (photo1, then photo2) as client profile photo.
   * Falls back to any image-like attachment labeled as foto.
   */
  function profilePhotoFromEnrollment(s) {
    if (!s) return null;
    const docs = s.documents && typeof s.documents === 'object' ? s.documents : null;
    function urlFromDoc(entry) {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      return entry.url || entry.secure_url || null;
    }
    if (docs) {
      const p1 = urlFromDoc(docs.photo1);
      if (p1) return p1;
      const p2 = urlFromDoc(docs.photo2);
      if (p2) return p2;
    }
    const atts = normalizeAttachments(s);
    const photoAtt = atts.find(a =>
      a && a.url && (
        a.key === 'photo1' || a.key === 'photo2' ||
        /foto|photo|passe/i.test(String(a.label || ''))
      ) && !/\.pdf($|\?)/i.test(a.url)
    );
    if (photoAtt) return photoAtt.url;
    // Last resort: first non-PDF image attachment
    const anyImg = atts.find(a => a && a.url && !/\.pdf($|\?)/i.test(a.url) && /\.(jpe?g|png|webp|gif)($|\?)/i.test(a.url));
    return anyImg ? anyImg.url : null;
  }

  function normalizeAttachments(s) {
    const list = [];
    const seen = new Set();
    function push(item) {
      if (!item) return;
      const url = typeof item === 'string' ? item : (item.url || '');
      if (!url || seen.has(url)) return;
      seen.add(url);
      const key = (typeof item === 'object' && item.key) ? item.key : 'doc';
      const label = (typeof item === 'object' && item.label)
        ? item.label
        : (DOC_KEY_LABELS[key] || 'Documento');
      list.push({
        url,
        label,
        key,
        name: (typeof item === 'object' && item.name) ? item.name : ''
      });
    }
    if (!s) return list;
    if (s.documents && typeof s.documents === 'object') {
      Object.keys(s.documents).forEach(k => {
        const d = s.documents[k];
        if (!d) return;
        push(typeof d === 'string' ? { url: d, key: k, label: DOC_KEY_LABELS[k] || k } : Object.assign({ key: k }, d));
      });
    }
    (s.attachments || []).forEach(push);
    if (s.paymentProof && typeof s.paymentProof === 'string') {
      push({ url: s.paymentProof, label: 'Comprovativo de pagamento', key: 'paymentProof' });
    }
    return list;
  }

  /** Client docs, or fall back to linked enrollment submission. */
  function clientAttachments(c) {
    if (!c) return [];
    const own = normalizeAttachments(c);
    if (own.length) return own;
    if (c.fromSubmission) {
      const sub = (store.submissions || []).find(s => s.id === c.fromSubmission);
      if (sub) return normalizeAttachments(sub);
    }
    return [];
  }

  function isImageUrl(url) {
    return /\.(jpe?g|png|gif|webp|bmp)($|\?)/i.test(url || '') ||
      (url || '').includes('/image/upload/');
  }

  /** Compact chips for client list — icon + short label, click opens file. */
  function renderDocChips(items) {
    if (!items || !items.length) return '';
    const chips = items.map(a => {
      const href = escapeHtml(fixAttachmentUrl(a.url));
      const label = escapeHtml(shortDocLabel(a));
      const img = isImageUrl(a.url);
      const icon = img ? '📷' : '📄';
      const title = escapeHtml(a.label || a.name || label);
      return `<a class="doc-chip ${img ? 'is-photo' : 'is-file'}" href="${href}" target="_blank" rel="noopener" title="${title}">${icon} ${label}</a>`;
    }).join('');
    return `<div class="row-docs">${chips}</div>`;
  }

  function renderAttachmentGallery(s) {
    const items = Array.isArray(s) ? s : normalizeAttachments(s);
    if (!items.length) return '';
    const cards = items.map((a, i) => {
      const href = escapeHtml(fixAttachmentUrl(a.url));
      const label = escapeHtml(a.label || ('Doc ' + (i + 1)));
      const thumb = isImageUrl(a.url)
        ? `<a href="${href}" target="_blank" rel="noopener" style="display:block;border:1px solid #ddd;border-radius:6px;overflow:hidden;aspect-ratio:4/3;background:#f4f4f4">
             <img src="${href}" alt="${label}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
           </a>`
        : `<a href="${href}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:6px;aspect-ratio:4/3;background:#f4f4f4;font-size:0.75rem;color:#555;text-decoration:none;padding:0.5rem;text-align:center">Abrir PDF / ficheiro</a>`;
      return `<div style="min-width:0">
        ${thumb}
        <div style="font-size:0.72rem;margin-top:0.35rem;color:#555;line-height:1.3">${label}</div>
      </div>`;
    }).join('');
    return `<div class="meta" style="margin-top:0.65rem"><strong>Documentos (${items.length})</strong></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.65rem;margin-top:0.45rem">${cards}</div>`;
  }

  /** Compact gallery for client modal: typed slots (BI, atestado, foto 1/2) + extras. */
  function renderClientDocsBlock(c) {
    const items = clientAttachments(c);
    const usedUrls = new Set();

    const slotsHtml = CLIENT_DOC_SLOTS.map(slot => {
      const found = findDocByKey(items, slot.key);
      if (found && found.url) usedUrls.add(found.url);
      const label = escapeHtml(slot.label);
      const short = escapeHtml(slot.short || slot.label);
      if (found && found.url) {
        const href = escapeHtml(fixAttachmentUrl(found.url));
        const urlAttr = escapeHtml(found.url);
        const img = isImageUrl(found.url);
        const preview = img
          ? `<a class="client-doc-slot-preview" href="${href}" target="_blank" rel="noopener" title="Abrir ${label}">
               <img src="${href}" alt="${short}" loading="lazy">
             </a>`
          : `<a class="client-doc-slot-preview is-file" href="${href}" target="_blank" rel="noopener" title="Abrir ${label}">📄 PDF</a>`;
        return `<div class="client-doc-slot is-filled" data-doc-key="${escapeHtml(slot.key)}">
          <div class="client-doc-slot-head">
            <span class="client-doc-slot-label">${label}</span>
            <span class="client-doc-slot-badge is-ok">Anexado</span>
          </div>
          <div class="client-doc-slot-body">
            ${preview}
            <div class="client-doc-slot-actions">
              <label class="btn-secondary client-doc-upload-label client-doc-slot-replace">
                Substituir
                <input type="file" class="c-doc-slot-upload" data-doc-key="${escapeHtml(slot.key)}" data-doc-label="${label}" accept="${escapeHtml(slot.accept)}" hidden>
              </label>
              <button type="button" class="pay-icon-btn pay-icon-danger client-doc-del" data-doc-del-url="${urlAttr}" title="Remover ${label}" aria-label="Remover ${label}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </div>
        </div>`;
      }
      return `<div class="client-doc-slot is-empty" data-doc-key="${escapeHtml(slot.key)}">
        <div class="client-doc-slot-head">
          <span class="client-doc-slot-label">${label}</span>
          <span class="client-doc-slot-badge">Em falta</span>
        </div>
        <div class="client-doc-slot-body">
          <p class="client-doc-slot-hint muted">${escapeHtml(slot.hint || '')}</p>
          <label class="btn-secondary client-doc-upload-label client-doc-slot-add">
            + Adicionar
            <input type="file" class="c-doc-slot-upload" data-doc-key="${escapeHtml(slot.key)}" data-doc-label="${label}" accept="${escapeHtml(slot.accept)}" hidden>
          </label>
        </div>
      </div>`;
    }).join('');

    // Extra / legacy docs that don't match a standard slot
    const extras = items.filter(a => a && a.url && !usedUrls.has(a.url));
    const extrasHtml = extras.length
      ? `<div class="client-docs-extras">
          <div class="meta" style="margin:0.55rem 0 0.35rem"><strong>Outros ficheiros</strong></div>
          <div class="client-docs-grid">${extras.map((a, idx) => {
            const href = escapeHtml(fixAttachmentUrl(a.url));
            const label = escapeHtml(shortDocLabel(a));
            const full = escapeHtml(a.label || a.name || label);
            const img = isImageUrl(a.url);
            const urlAttr = escapeHtml(a.url);
            const body = img
              ? `<a class="client-doc-thumb" href="${href}" target="_blank" rel="noopener" title="${full}">
                  <img src="${href}" alt="${label}" loading="lazy">
                  <span>${label}</span>
                </a>`
              : `<a class="client-doc-file" href="${href}" target="_blank" rel="noopener" title="${full}">📄 ${label}</a>`;
            return `<div class="client-doc-item" data-doc-url="${urlAttr}" data-doc-idx="${idx}">
              ${body}
              <button type="button" class="pay-icon-btn pay-icon-danger client-doc-del" data-doc-del-url="${urlAttr}" title="Remover documento" aria-label="Remover documento">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>`;
          }).join('')}</div>
        </div>`
      : '';

    const filled = CLIENT_DOC_SLOTS.filter(s => findDocByKey(items, s.key)).length;
    return `<div id="cDocsBlock" class="client-docs-block">
      <div class="meta" style="margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap">
        <strong>Documentos oficiais (${filled}/${CLIENT_DOC_SLOTS.length})</strong>
        <span class="muted" style="font-size:0.75rem">BI · atestado · 2 fotos · pagamento</span>
      </div>
      <div class="client-doc-slots">${slotsHtml}</div>
      ${extrasHtml}
      <p id="cDocUploadStatus" class="muted" style="font-size:0.75rem;margin:0.45rem 0 0;min-height:1.1em"></p>
    </div>`;
  }

  function bindClientDocsActions() {
    const host = $('#cDocsHost');
    if (!host) return;
    host.querySelectorAll('[data-doc-del-url]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = btn.getAttribute('data-doc-del-url');
        if (!url || !editingClientId) return;
        if (!(await adminConfirm('Remover este documento do cliente?', {
          title: 'Remover documento', confirmLabel: 'Remover', danger: true
        }))) return;
        await removeClientAttachment(url);
      });
    });
    host.querySelectorAll('.c-doc-slot-upload').forEach(input => {
      input.addEventListener('change', async () => {
        const files = input.files;
        if (!files || !files.length) return;
        if (!editingClientId) {
          toast('Guarde o cliente primeiro, depois adicione documentos');
          input.value = '';
          return;
        }
        const key = input.getAttribute('data-doc-key') || 'doc';
        const label = input.getAttribute('data-doc-label') || (DOC_KEY_LABELS[key] || 'Documento');
        await uploadClientAttachmentForSlot(files[0], key, label);
        input.value = '';
      });
    });
  }

  async function uploadClientAttachmentForSlot(file, key, label) {
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return toast('Cliente não encontrado');
    if (!file) return;
    const status = $('#cDocUploadStatus');
    if (status) status.textContent = 'A carregar ' + (label || 'documento') + '…';

    let url;
    try {
      url = await uploadToCloudinary(file);
    } catch (err) {
      console.warn('client doc upload failed', err);
      if (status) status.textContent = '';
      toast('Erro no upload: ' + (err.message || err));
      return;
    }

    const entry = {
      url,
      label: label || DOC_KEY_LABELS[key] || 'Documento',
      key: key || 'doc',
      name: file.name || ''
    };

    // Replace any previous file for this slot key
    let attachments = normalizeAttachments(existing).filter(a => a.key !== key);
    // Also drop heuristic matches for the same slot so we don't keep duplicates
    attachments = attachments.filter(a => {
      if (a.url === url) return false;
      const other = findDocByKey([a], key);
      return !other;
    });
    attachments.push(entry);

    let documents = Object.assign({}, (existing.documents && typeof existing.documents === 'object') ? existing.documents : {});
    documents[key] = entry;

    const data = enrichClient(Object.assign({}, existing, {
      attachments,
      documents,
      // Dedicated payment proof field mirrors the slot when used
      paymentProof: key === 'paymentProof' ? url : (existing.paymentProof || null)
    }));
    const saved = await adminAction('update_client', data);
    if (status) status.textContent = saved ? (label + ' adicionado') : '';
    if (saved) {
      toast(label + ' guardado');
      // Soft refresh: keep form fields the staff may still be editing
      refreshClientMediaUI({ keepDocsOpen: true });
    } else {
      toast('Upload feito, mas falhou a gravar no servidor. Verifique a migração D1 (0003).');
    }
  }

  async function removeClientAttachment(url) {
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    let attachments = normalizeAttachments(existing).filter(a => a.url !== url);
    // Also clear matching paymentProof / documents keys if they point to this URL
    let paymentProof = existing.paymentProof;
    if (paymentProof === url) paymentProof = null;
    let documents = existing.documents;
    if (documents && typeof documents === 'object') {
      documents = Object.assign({}, documents);
      Object.keys(documents).forEach(k => {
        const d = documents[k];
        const u = typeof d === 'string' ? d : (d && d.url);
        if (u === url) delete documents[k];
      });
    }
    const data = enrichClient(Object.assign({}, existing, {
      attachments,
      documents,
      paymentProof
    }));
    const saved = await adminAction('update_client', data);
    if (saved) {
      toast('Documento removido');
      refreshClientMediaUI({ keepDocsOpen: true });
    }
  }

  function clientInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function renderClientPhoto(c) {
    const img = $('#cPhotoImg');
    const initials = $('#cPhotoInitials');
    const removeBtn = $('#cPhotoRemove');
    const status = $('#cPhotoStatus');
    const avatar = $('#cPhotoAvatar');
    const url = c && c.photoUrl ? String(c.photoUrl) : '';
    if (img) {
      if (url) {
        img.src = url;
        img.hidden = false;
        img.alt = (c && c.name) ? ('Foto de ' + c.name) : 'Foto de perfil';
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        img.alt = '';
      }
    }
    if (initials) {
      initials.textContent = clientInitials(c && c.name);
      initials.style.display = url ? 'none' : '';
    }
    if (avatar) {
      avatar.disabled = !url;
      avatar.title = url ? 'Ver foto ampliada' : 'Sem foto de perfil';
      avatar.setAttribute('aria-label', url ? 'Ver foto de perfil ampliada' : 'Sem foto de perfil');
      avatar.dataset.photoUrl = url || '';
      avatar.dataset.photoName = (c && c.name) ? String(c.name) : '';
    }
    if (removeBtn) removeBtn.style.display = url && editingClientId ? '' : 'none';
    if (status) status.textContent = '';
  }

  function openPhotoLightbox(url, name) {
    if (!url) return;
    const box = $('#photoLightbox');
    const img = $('#photoLightboxImg');
    const caption = $('#photoLightboxCaption');
    if (!box || !img) return;
    img.src = url;
    img.alt = name ? ('Foto de ' + name) : 'Foto de perfil do cliente';
    if (caption) caption.textContent = name || '';
    box.classList.add('open');
  }

  function closePhotoLightbox() {
    const box = $('#photoLightbox');
    const img = $('#photoLightboxImg');
    if (box) box.classList.remove('open');
    if (img) {
      img.removeAttribute('src');
      img.alt = '';
    }
  }

  async function uploadClientPhoto(file) {
    if (!file) return;
    if (!editingClientId) {
      toast('Guarde o cliente primeiro, depois adicione a foto');
      return;
    }
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return toast('Cliente não encontrado');
    const status = $('#cPhotoStatus');
    if (status) status.textContent = 'A carregar foto…';
    try {
      const url = await uploadToCloudinary(file);
      const data = enrichClient(Object.assign({}, existing, { photoUrl: url }));
      const saved = await adminAction('update_client', data);
      if (status) status.textContent = '';
      if (saved) {
        toast('Foto de perfil actualizada');
        // Soft refresh: do not wipe unsaved form fields
        refreshClientMediaUI();
      }
    } catch (err) {
      console.warn('client photo upload failed', err);
      if (status) status.textContent = '';
      toast('Erro no upload: ' + (err.message || err));
    }
  }

  async function removeClientPhoto() {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    if (!(await adminConfirm('Remover a foto de perfil deste cliente?', {
      title: 'Remover foto', confirmLabel: 'Remover', danger: true
    }))) return;
    const data = enrichClient(Object.assign({}, existing, { photoUrl: null }));
    const saved = await adminAction('update_client', data);
    if (saved) {
      toast('Foto removida');
      refreshClientMediaUI();
    }
  }

  function bindSubmissionActions(list) {
    if (!list) return;
    list.querySelectorAll('[data-st]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-st');
        const status = btn.getAttribute('data-v');
        if (!id || !status) return;
        btn.disabled = true;
        const ok = await adminAction('update_submission', { id, status });
        if (ok) toast('Estado actualizado');
        else {
          btn.disabled = false;
          toast('Não foi possível actualizar');
        }
      });
    });
    list.querySelectorAll('[data-del-sub]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-del-sub');
        if (!id) return;
        const purge = btn.getAttribute('data-purge') === '1';
        if (purge) {
          if (!(await adminConfirm('Apagar definitivamente? Já não poderá restaurar.', {
            title: 'Apagar inscrição', confirmLabel: 'Apagar já', danger: true
          }))) return;
        } else if (!(await adminConfirm('Mover para a lixeira? Pode restaurar nos próximos 30 dias.', {
          title: 'Lixeira', confirmLabel: 'Mover para lixeira', danger: true
        }))) {
          return;
        }
        btn.disabled = true;
        const ok = await adminAction('delete_submission', { id, purge: !!purge });
        if (ok) toast(purge ? 'Apagado definitivamente' : 'Na lixeira (30 dias)');
        else {
          btn.disabled = false;
          toast('Não foi possível apagar');
        }
      });
    });
    list.querySelectorAll('[data-restore-sub]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-restore-sub');
        if (!id) return;
        btn.disabled = true;
        const ok = await adminAction('restore_submission', { id });
        if (ok) toast('Restaurado (arquivado)');
        else {
          btn.disabled = false;
          toast('Não foi possível restaurar');
        }
      });
    });
  }

  async function adminAction(action, data, opts) {
    const silent = opts && opts.silent;
    localWriteInFlight++;
    localWriteUntil = Date.now() + LOCAL_WRITE_COOLDOWN_MS;
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action,
          data,
          adminName: getAdminName()
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          // Own write (legacy dual-write path): apply store then overlay D1
          store = json.store;
          if (json.store.updatedAt) lastKnownUpdatedAt = json.store.updatedAt;
        }
        // After cutover, mutations return without store — always re-read ops from D1
        if (action === 'update_client' || action === 'delete_client' || action === 'restore_client') {
          await overlayClientsFromD1({ force: true });
        }
        if (
          action === 'update_submission' ||
          action === 'delete_submission' ||
          action === 'restore_submission'
        ) {
          await overlaySubmissionsFromD1();
        }
        if (action === 'delete_newsletter') {
          await overlayNewslettersFromD1();
        }
        renderInbox();
        renderContacts();
        renderNewsletters();
        renderClients();
        if (json.store) broadcastStore(store);
        setSyncStatus('ok', 'Sincronizado');
        return true;
      } else {
        if (res.status === 401) {
          setSessionPassword('');
          sessionStorage.removeItem(LS.auth);
          toast('Sessão expirada — volte a entrar');
          location.reload();
          return false;
        }
        if (!silent) toast('Erro ao actualizar');
        setSyncStatus('error', 'Erro ao gravar');
        return false;
      }
    } catch (e) {
      if (!silent) {
        toast(
          isTimeoutError(e)
            ? 'Servidor não respondeu. Tente de novo ou use outra rede.'
            : 'Erro de rede'
        );
      }
      setSyncStatus(
        'error',
        isTimeoutError(e) ? 'Servidor não respondeu (tempo esgotado)' : 'Erro de rede'
      );
      return false;
    } finally {
      localWriteInFlight = Math.max(0, localWriteInFlight - 1);
    }
  }

  // —— Bulk selection ——
  // Survives list re-renders (poll / D1 overlay used to wipe checkbox state).
  const bulkSelected = {
    clients: new Set(),
    inbox: new Set(),
    contacts: new Set(),
    newsletters: new Set()
  };

  function getSelectedIds(listName) {
    const set = bulkSelected[listName];
    if (set) return Array.from(set);
    return $$('.bulk-item[data-list="' + listName + '"]:checked').map(el => el.dataset.id).filter(Boolean);
  }

  function clearBulkSelection(listName) {
    const set = bulkSelected[listName];
    if (set) set.clear();
  }

  /** After re-render, re-check boxes that were selected before the DOM was rebuilt.
   * Does not drop ids just because a filter hides them — only clearBulkSelection does.
   */
  function restoreBulkSelection(listName) {
    const set = bulkSelected[listName];
    if (!set || !set.size) return;
    $$('.bulk-item[data-list="' + listName + '"]').forEach(cb => {
      const id = String(cb.dataset.id || '');
      cb.checked = !!(id && set.has(id));
    });
  }

  function idsMatch(a, b) {
    return a != null && b != null && String(a) === String(b);
  }

  function clientById(id) {
    return (store.clients || []).find(c => idsMatch(c.id, id)) || null;
  }

  /** Swap bulk action buttons for normal vs lixeira view. */
  function syncClientsBulkActionsForFilter() {
    const inTrash = clientsFilter === 'lixeira';
    $$('#clientsBulkBar .bulk-action, #clientsBulkFloat .bulk-action').forEach(btn => {
      const act = btn.dataset.action;
      if (!act) return;
      if (inTrash) {
        // Trash: Restaurar / Apagar já / WhatsApp / Exportar
        if (act === 'suspend' || act === 'archive') {
          btn.style.display = 'none';
        } else if (act === 'restore') {
          btn.style.display = '';
        } else if (act === 'delete') {
          btn.style.display = '';
          btn.textContent = 'Apagar já';
          btn.title = 'Apagar definitivamente';
        } else {
          btn.style.display = '';
        }
      } else {
        if (act === 'restore') {
          btn.style.display = 'none';
        } else if (act === 'delete') {
          btn.style.display = '';
          btn.textContent = 'Apagar';
          btn.title = 'Mover para a lixeira';
        } else {
          btn.style.display = '';
        }
      }
    });
  }

  function updateBulkBar(listName) {
    const bar = document.querySelector('.bulk-bar[data-list="' + listName + '"]');
    if (!bar) return;
    const items = $$('.bulk-item[data-list="' + listName + '"]');
    const selected = getSelectedIds(listName);
    const countEl = bar.querySelector('.bulk-count[data-list="' + listName + '"]');
    if (countEl) countEl.textContent = selected.length ? selected.length + ' seleccionado(s)' : '0';
    // Top bar: show whenever there are list items (select-all always available)
    bar.style.display = items.length ? '' : 'none';
    const all = bar.querySelector('.bulk-select-all[data-list="' + listName + '"]');
    if (all) {
      all.checked = items.length > 0 && selected.length === items.length && items.length > 0;
      all.indeterminate = selected.length > 0 && selected.length < items.length;
    }
    // Floating action bar for clients when something is selected
    if (listName === 'clients') {
      syncClientsBulkActionsForFilter();
      const float = $('#clientsBulkFloat');
      if (float) {
        if (selected.length > 0) {
          float.hidden = false;
          const fc = float.querySelector('.bulk-float-count');
          if (fc) fc.textContent = selected.length + ' seleccionado' + (selected.length === 1 ? '' : 's');
        } else {
          float.hidden = true;
        }
      }
    }
  }

  function bindBulkItemChecks(listName) {
    const set = bulkSelected[listName] || (bulkSelected[listName] = new Set());
    $$('.bulk-item[data-list="' + listName + '"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = String(cb.dataset.id || '');
        if (!id) return;
        if (cb.checked) set.add(id);
        else set.delete(id);
        updateBulkBar(listName);
      });
    });
  }

  async function runBulkAction(listName, action) {
    const ids = getSelectedIds(listName);
    if (!ids.length) return toast('Seleccione pelo menos um item');

    // Clients: bulk WhatsApp / export selected
    if (listName === 'clients' && action === 'whatsapp') {
      const clients = (store.clients || []).filter(c => ids.some(id => idsMatch(c.id, id)));
      const phones = clients.map(c => c.phone).filter(Boolean);
      if (!phones.length) return toast('Nenhum telefone nos seleccionados');
      const first = clients.find(c => c.phone);
      const wa = first ? whatsappUrl(first.phone) : null;
      try {
        await navigator.clipboard.writeText(phones.join('\n'));
        toast(phones.length + ' telefone(s) copiados' + (wa ? ' · a abrir WhatsApp…' : ''));
      } catch (e) {
        toast('Não foi possível copiar telefones');
      }
      if (wa) window.open(wa, '_blank', 'noopener');
      return;
    }
    if (listName === 'clients' && action === 'export') {
      const items = getVisibleClients().filter(c => ids.some(id => idsMatch(c.id, id)));
      if (!items.length) return toast('Nada para exportar');
      const headers = ['Nº', 'Nome', 'Telefone', 'Email', 'Área', 'Idade', 'Horário', 'Cartão', 'Plano', 'Preço', 'Ciclo', 'Início', 'Fim', 'Membership', 'Faturação', 'Emergência', 'Tel. emergência', 'Notas'];
      const rows = items.map(c => [
        c.memberNumber, c.name, c.phone, c.email, c.area, c.age, c.schedule, c.hasCard,
        c.planName || c.planId, c.price,
        c.billingCycle, c.planStart, c.planEnd, c.membershipStatus, c.billingStatus,
        c.emergencyName, c.emergencyPhone, c.notes
      ].map(v => {
        const s = v == null ? '' : String(v);
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(','));
      const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'buzios-clientes-seleccionados-' + todayISO() + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      toast(items.length + ' cliente(s) exportados');
      return;
    }

    if (listName === 'clients' && action === 'restore') {
      if (!(await adminConfirm(
        'Restaurar ' + ids.length + ' cliente(s) da lixeira?',
        { title: 'Restaurar', confirmLabel: 'Restaurar' }
      ))) return;
      let ok = 0;
      for (const id of ids) {
        if (await adminAction('restore_client', { id }, { silent: true })) ok++;
      }
      renderClients();
      toast(ok + ' de ' + ids.length + ' restaurado(s)');
      return;
    }

    if (action === 'delete') {
      const inTrash = listName === 'clients' && clientsFilter === 'lixeira';
      if (inTrash) {
        if (!(await adminConfirm(
          'Apagar definitivamente ' + ids.length + ' cliente(s)?\nEsta acção não pode ser desfeita.',
          { title: 'Apagar já', confirmLabel: 'Apagar definitivamente', danger: true }
        ))) return;
      } else {
        if (!(await adminConfirm(
          'Mover ' + ids.length + ' item(ns) para a lixeira?\nPode restaurar nos próximos 30 dias.',
          { title: 'Lixeira', confirmLabel: 'Mover para lixeira', danger: true }
        ))) return;
      }
    }

    let ok = 0;
    for (const id of ids) {
      let success = false;
      if (listName === 'inbox' || listName === 'contacts') {
        if (action === 'delete') {
          success = await adminAction('delete_submission', { id }, { silent: true });
        } else {
          success = await adminAction('update_submission', { id, status: action }, { silent: true });
        }
      } else if (listName === 'newsletters') {
        if (action === 'delete') {
          success = await adminAction('delete_newsletter', { id }, { silent: true });
        }
      } else if (listName === 'clients') {
        if (action === 'delete') {
          const inTrash = clientsFilter === 'lixeira';
          success = await adminAction(
            'delete_client',
            inTrash ? { id, hard: true, purge: true } : { id, hard: true },
            { silent: true }
          );
        } else if (action === 'archive') {
          const existing = clientById(id);
          if (existing && isInTrash(existing)) {
            toast('Na lixeira: use Restaurar, não Arquivar');
            continue;
          }
          success = await adminAction('delete_client', { id, hard: false }, { silent: true });
        } else if (action === 'suspend') {
          const existing = clientById(id);
          if (!existing) continue;
          if (isInTrash(existing)) {
            toast('Na lixeira: use Restaurar primeiro');
            continue;
          }
          success = await adminAction(
            'update_client',
            enrichClient(Object.assign({}, existing, { membershipStatus: 'suspenso' })),
            { silent: true }
          );
        }
      }
      if (success) ok++;
    }
    // Clear selection for processed ids so they don't stick after re-render
    clearBulkSelection(listName);
    renderInbox();
    renderContacts();
    renderNewsletters();
    renderClients();
    toast(ok + ' de ' + ids.length + ' actualizado(s)');
  }

  // Wire bulk bars once
  $$('.bulk-select-all').forEach(all => {
    all.addEventListener('change', () => {
      const listName = all.dataset.list;
      const set = bulkSelected[listName] || (bulkSelected[listName] = new Set());
      $$('.bulk-item[data-list="' + listName + '"]').forEach(cb => {
        cb.checked = all.checked;
        const id = String(cb.dataset.id || '');
        if (!id) return;
        if (all.checked) set.add(id);
        else set.delete(id);
      });
      updateBulkBar(listName);
    });
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.bulk-action');
    if (!btn || !btn.dataset.list) return;
    runBulkAction(btn.dataset.list, btn.dataset.action);
  });
  $('#clientsBulkClear')?.addEventListener('click', () => {
    clearBulkSelection('clients');
    $$('.bulk-item[data-list="clients"]').forEach(cb => { cb.checked = false; });
    updateBulkBar('clients');
  });

  // Keyboard shortcuts on Clients panel: / = search, N = new client
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    if (typing && e.key !== 'Escape') return;
    const clientsPanel = $('#panel-clients');
    if (!clientsPanel || !clientsPanel.classList.contains('active')) return;
    if (e.key === '/' && !typing) {
      e.preventDefault();
      const search = $('#clientSearch');
      if (search) { search.focus(); search.select(); }
    } else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
      e.preventDefault();
      openClientModal(null);
    }
  });

  // —— Newsletter phones ——
  function updateNewslettersNavBadge() {
    const btn = document.querySelector('.admin-tabs button[data-panel="newsletters"]');
    if (!btn) return;
    let badge = btn.querySelector('.nav-badge');
    // Drop ids that no longer exist (deleted)
    const live = new Set((store.newsletters || []).map(n => String(n.id)));
    unseenNewsletterIds.forEach(id => {
      if (!live.has(id)) unseenNewsletterIds.delete(id);
    });
    const n = unseenNewsletterIds.size;
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
      badge.title = n === 1 ? '1 novo na newsletter' : n + ' novos na newsletter';
    } else if (badge) {
      badge.style.display = 'none';
      badge.title = '';
    }
  }

  function markNewslettersSeen() {
    unseenNewsletterIds.clear();
    updateNewslettersNavBadge();
  }

  function renderNewsletters() {
    const list = $('#newslettersList');
    if (!list) return;
    updateNewslettersNavBadge();
    const items = store.newsletters || [];
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhum número ainda. Aparecem quando alguém preenche o formulário no rodapé do site.</p>';
      updateBulkBar('newsletters');
      return;
    }
    list.innerHTML = items.map(n => {
      const when = n.createdAt ? formatDateTimeAO(n.createdAt) : '';
      const phone = n.phone || '—';
      const wa = String(phone).replace(/\D/g, '');
      const waLink = wa ? `https://wa.me/${wa.startsWith('244') ? wa : '244' + wa}` : '#';
      return `
        <div class="prod-card">
          <label class="card-check"><input type="checkbox" class="bulk-item" data-list="newsletters" data-id="${escapeHtml(n.id)}"></label>
          <h3>${phone}</h3>
          <div class="meta">${when}</div>
          <div class="actions" style="margin-top:0.65rem">
            <a href="${waLink}" target="_blank" rel="noopener" style="padding:0.4rem 0.75rem;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:0.8rem;text-decoration:none;color:inherit">WhatsApp</a>
            <button type="button" class="danger" data-del-nl="${n.id}">Apagar</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-del-nl]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await adminConfirm('Apagar este número da newsletter?', {
          title: 'Newsletter', confirmLabel: 'Apagar', danger: true
        }))) return;
        await adminAction('delete_newsletter', { id: btn.dataset.delNl });
        toast('Número apagado');
      });
    });
    bindBulkItemChecks('newsletters');
    restoreBulkSelection('newsletters');
    updateBulkBar('newsletters');
  }

  $('#copyNewslettersBtn')?.addEventListener('click', async () => {
    const phones = (store.newsletters || []).map(n => n.phone).filter(Boolean);
    if (!phones.length) {
      toast('Nenhum número para copiar');
      return;
    }
    try {
      await navigator.clipboard.writeText(phones.join('\n'));
      toast(phones.length + ' número(s) copiado(s)');
    } catch (e) {
      toast('Não foi possível copiar');
    }
  });

  // —— Clients (membership dates, debt, alerts) ——
  let clientsFilter = 'all';
  let clientsSearch = '';
  let clientsSort = 'priority';
  let clientsAgeFilter = '';

  const CYCLE_MONTHS = { mensal: 1, trimestral: 3, anual: 12, pacote: 1 };
  const ANNUAL_FEE_ID = 'inscricao-anual';
  const ANNUAL_FEE_DEFAULT = 6500;
  const SWIM_FEE_ID = 'natacao-inscricao';
  const SWIM_FEE_DEFAULT = 10500;
  const EXTRA_AVALIACAO_ID = 'avaliacao-fisica';
  const EXTRA_AVALIACAO_DEFAULT = 5000;
  const EXTRA_AVULSAS_ID = 'aulas-avulsas';
  const EXTRA_AVULSAS_DEFAULT = 30000;

  /** Full years from YYYY-MM-DD. */
  function ageFromBirthDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null;
    const parts = String(iso).split('-').map(Number);
    const y = parts[0];
    const m = parts[1];
    const day = parts[2];
    if (!y || !m || !day) return null;
    const today = new Date();
    let age = today.getFullYear() - y;
    const md = today.getMonth() + 1;
    const dd = today.getDate();
    if (md < m || (md === m && dd < day)) age -= 1;
    if (age < 0 || age > 120) return null;
    return age;
  }

  function productPrice(id, fallback) {
    const p = (products || []).find(x => x.id === id);
    const n = p && p.price != null ? Number(p.price) : fallback;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  function annualFeeAmount() { return productPrice(ANNUAL_FEE_ID, ANNUAL_FEE_DEFAULT); }
  function swimFeeAmount() { return productPrice(SWIM_FEE_ID, SWIM_FEE_DEFAULT); }
  function avaliacaoAmount() { return productPrice(EXTRA_AVALIACAO_ID, EXTRA_AVALIACAO_DEFAULT); }
  function avulsasAmount() { return productPrice(EXTRA_AVULSAS_ID, EXTRA_AVULSAS_DEFAULT); }

  /** Recurring plan price from form (cPrice), ignoring one-off addons. */
  function planPriceFromForm() {
    const raw = $('#cPrice') && $('#cPrice').value;
    if (raw === '' || raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function formatKzLabel(n) {
    return Number(n).toLocaleString('pt') + ' Kz';
  }

  function updateClientAddonVisibility() {
    const area = ($('#cArea') && $('#cArea').value) || 'ginasio';
    const isGym = area === 'ginasio' || area === 'ambos';
    const isSwim = area === 'natacao' || area === 'ambos';
    const setDisp = (sel, show) => {
      const el = $(sel);
      if (!el) return;
      el.style.display = show ? 'flex' : 'none';
    };
    setDisp('#cAnnualFeeRow', isGym);
    setDisp('#cExtraAvaliacaoRow', isGym);
    setDisp('#cExtraAvulsasRow', isGym);
    setDisp('#cSwimFeeRow', isSwim);
    if ($('#cAnnualFeePrice')) $('#cAnnualFeePrice').textContent = formatKzLabel(annualFeeAmount());
    if ($('#cSwimFeePrice')) $('#cSwimFeePrice').textContent = formatKzLabel(swimFeeAmount());
    if ($('#cExtraAvaliacaoPrice')) $('#cExtraAvaliacaoPrice').textContent = formatKzLabel(avaliacaoAmount());
    if ($('#cExtraAvulsasPrice')) $('#cExtraAvulsasPrice').textContent = formatKzLabel(avulsasAmount());
  }

  function addonsTotalFromForm() {
    let t = 0;
    const area = ($('#cArea') && $('#cArea').value) || 'ginasio';
    const isGym = area === 'ginasio' || area === 'ambos';
    const isSwim = area === 'natacao' || area === 'ambos';
    if (isGym && $('#cAnnualFee') && $('#cAnnualFee').checked) t += annualFeeAmount();
    if (isSwim && $('#cSwimFee') && $('#cSwimFee').checked) t += swimFeeAmount();
    if (isGym && $('#cExtraAvaliacao') && $('#cExtraAvaliacao').checked) t += avaliacaoAmount();
    if (isGym && $('#cExtraAvulsas') && $('#cExtraAvulsas').checked) t += avulsasAmount();
    return t;
  }

  function addonLabelsFromForm() {
    const labels = [];
    const area = ($('#cArea') && $('#cArea').value) || 'ginasio';
    const isGym = area === 'ginasio' || area === 'ambos';
    const isSwim = area === 'natacao' || area === 'ambos';
    if (isGym && $('#cAnnualFee') && $('#cAnnualFee').checked) labels.push('Inscrição anual ' + formatKzLabel(annualFeeAmount()));
    if (isSwim && $('#cSwimFee') && $('#cSwimFee').checked) labels.push('Inscrição natação ' + formatKzLabel(swimFeeAmount()));
    if (isGym && $('#cExtraAvaliacao') && $('#cExtraAvaliacao').checked) labels.push('Avaliação física ' + formatKzLabel(avaliacaoAmount()));
    if (isGym && $('#cExtraAvulsas') && $('#cExtraAvulsas').checked) labels.push('Aulas avulsas ' + formatKzLabel(avulsasAmount()));
    return labels;
  }

  /** cPayAmount = plan + selected one-offs. cPrice stays recurring only. */
  function syncPayAmountWithAnnual() {
    const payEl = $('#cPayAmount');
    if (!payEl) return;
    const total = planPriceFromForm() + addonsTotalFromForm();
    payEl.value = total > 0 ? total : '';
    updatePayPreview();
  }

  function clearAddonCheckboxes() {
    ['cAnnualFee', 'cSwimFee', 'cExtraAvaliacao', 'cExtraAvulsas'].forEach(id => {
      if ($('#' + id)) $('#' + id).checked = false;
    });
  }

  function clientExtrasFromForm() {
    const extras = [];
    if ($('#cExtraAvaliacao') && $('#cExtraAvaliacao').checked) extras.push(EXTRA_AVALIACAO_ID);
    if ($('#cExtraAvulsas') && $('#cExtraAvulsas').checked) extras.push(EXTRA_AVULSAS_ID);
    return extras;
  }

  function addonsFromSubmission(s) {
    const lines = Array.isArray(s && s.lineItems) ? s.lineItems : [];
    const extraIds = Array.isArray(s && s.extras) ? s.extras.slice() : [];
    lines.forEach(l => {
      if (l && l.id && !extraIds.includes(l.id)) extraIds.push(l.id);
    });
    const has = (id) => extraIds.includes(id) || lines.some(l => l && l.id === id);
    return {
      annualFee: !!(s && s.annualFee) || has(ANNUAL_FEE_ID),
      swimFee: has(SWIM_FEE_ID),
      extras: [EXTRA_AVALIACAO_ID, EXTRA_AVULSAS_ID].filter(id => has(id))
    };
  }

  /** Calendar date (YYYY-MM-DD) in Angola — not browser TZ / UTC. */
  function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: AO_TZ });
  }

  /** Instant for a civil date+time in Angola (permanent UTC+1). */
  function angolaDateTimeISO(dateStr, timeStr) {
    const t = (timeStr && /^\d{2}:\d{2}/.test(timeStr)) ? timeStr.slice(0, 5) : '12:00';
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date().toISOString();
    const d = new Date(dateStr + 'T' + t + ':00' + AO_OFFSET);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    // End of day Angola, vs start of today Angola
    const end = new Date(dateStr + 'T23:59:59' + AO_OFFSET);
    const todayStr = todayISO();
    const today = new Date(todayStr + 'T00:00:00' + AO_OFFSET);
    return Math.ceil((end - today) / 86400000);
  }

  function addMonthsISO(isoDate, months) {
    // Anchor at noon Angola so month arithmetic stays on the intended civil day
    const base = isoDate
      ? new Date(isoDate + 'T12:00:00' + AO_OFFSET)
      : new Date();
    base.setMonth(base.getMonth() + months);
    // Return the calendar date in Angola for that instant
    return base.toLocaleDateString('en-CA', { timeZone: AO_TZ });
  }

  function formatDatePT(iso) {
    if (!iso) return '—';
    try {
      const [y, m, d] = iso.split('-');
      return d + '/' + m + '/' + y;
    } catch (e) {
      return iso;
    }
  }

  function normalizePhone(p) {
    return String(p || '').replace(/\D/g, '');
  }

  function whatsappUrl(phone) {
    const wa = normalizePhone(phone);
    if (!wa) return null;
    const full = wa.startsWith('244') ? wa : '244' + wa;
    return 'https://wa.me/' + full;
  }

  /** Derive membership/billing from planEnd (respect suspenso/cancelado/arquivado/isento). */
  function enrichClient(c) {
    const out = Object.assign({}, c);
    let days = daysUntil(out.planEnd);
    out._daysLeft = days;
    out._expiringSoon = days !== null && days >= 0 && days <= 7;
    out._expired = days !== null && days < 0;

    // Manual overrides that must not be auto-flipped by planEnd
    if (
      out.membershipStatus === 'suspenso' ||
      out.membershipStatus === 'cancelado' ||
      out.membershipStatus === 'arquivado' ||
      out.membershipStatus === 'pendente'
    ) {
      return out;
    }
    if (out.billingStatus === 'isento' || out.billingStatus === 'desistente') {
      if (out.billingStatus === 'isento' && out._expired) out.membershipStatus = out.membershipStatus || 'activo';
      return out;
    }
    // Explicit "expirado" from the form: keep it. If planEnd is still in the future
    // (or missing), backdate planEnd to yesterday so derived state matches.
    if (out.membershipStatus === 'expirado') {
      if (days === null || days >= 0) {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        out.planEnd = y.toISOString().slice(0, 10);
        days = -1;
        out._daysLeft = -1;
        out._expiringSoon = false;
        out._expired = true;
      }
      if (out.billingStatus !== 'isento' && out.billingStatus !== 'desistente') out.billingStatus = 'em_divida';
      return out;
    }
    if (out._expired) {
      out.membershipStatus = 'expirado';
      if (out.billingStatus !== 'isento' && out.billingStatus !== 'desistente') out.billingStatus = 'em_divida';
    }
    // Do NOT force expirado → activo when planEnd is still valid; respect explicit choice.
    if (out.billingStatus === 'atrasado') out.billingStatus = 'em_divida';
    return out;
  }

  function isInTrash(item) {
    return !!(item && item.deletedAt);
  }

  function clientMatchesFilter(c, filter) {
    if (filter === 'lixeira') return isInTrash(c);
    // All non-trash views hide trashed rows
    if (isInTrash(c)) return false;
    if (filter === 'all') return c.membershipStatus !== 'arquivado';
    if (filter === 'activo') return c.membershipStatus === 'activo' && !c._expired;
    if (filter === 'a_expirar') return c._expiringSoon && c.membershipStatus === 'activo';
    if (filter === 'expirado') return c.membershipStatus === 'expirado' || c._expired;
    if (filter === 'em_divida') return c.billingStatus === 'em_divida' || c.billingStatus === 'atrasado';
    if (filter === 'pendente') return c.membershipStatus === 'pendente';
    if (filter === 'suspenso') return c.membershipStatus === 'suspenso' || c.membershipStatus === 'cancelado';
    if (filter === 'arquivado') return c.membershipStatus === 'arquivado';
    return true;
  }

  /** Strip Portuguese diacritics so "Jose" matches "José", "c" matches "ç", etc. */
  function normalizeForSearch(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ç/g, 'c');
  }

  function clientMatchesSearch(c, q) {
    if (!q) return true;
    const nq = normalizeForSearch(q);
    const hay = [
      c.name, c.phone, c.email, c.planName, c.notes,
      c.emergencyName, c.emergencyPhone, c.memberNumber, c.schedule, c.age, c.hasCard
    ]
      .map(x => normalizeForSearch(x))
      .join(' ');
    const digits = normalizePhone(q);
    if (digits && normalizePhone(c.phone).includes(digits)) return true;
    if (/^\d+$/.test(q.trim()) && String(c.memberNumber || '') === q.trim()) return true;
    return hay.includes(nq);
  }

  function sortClients(items, mode) {
    const list = items.slice();
    if (mode === 'name') {
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'));
    } else if (mode === 'planEnd') {
      list.sort((a, b) => String(a.planEnd || '9999').localeCompare(String(b.planEnd || '9999')));
    } else if (mode === 'recent') {
      list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    } else {
      // priority: debt → expiring → pending → rest
      list.sort((a, b) => {
        const score = (c) => {
          if (c.membershipStatus === 'arquivado') return 9;
          if (c.billingStatus === 'em_divida' || c._expired) return 0;
          if (c._expiringSoon) return 1;
          if (c.membershipStatus === 'pendente') return 2;
          if (c.membershipStatus === 'suspenso') return 3;
          return 4;
        };
        const d = score(a) - score(b);
        if (d !== 0) return d;
        return String(a.planEnd || '9999').localeCompare(String(b.planEnd || '9999'));
      });
    }
    return list;
  }

  function clientsStats(items) {
    let activo = 0, aExpirar = 0, expirado = 0, divida = 0, pendente = 0, visible = 0;
    items.forEach(c => {
      if (isInTrash(c)) return;
      if (c.membershipStatus === 'arquivado') return;
      visible++;
      if (c.membershipStatus === 'pendente') pendente++;
      if (c.membershipStatus === 'activo' && !c._expired) activo++;
      if (c._expiringSoon && c.membershipStatus === 'activo') aExpirar++;
      if (c.membershipStatus === 'expirado' || c._expired) expirado++;
      if (c.billingStatus === 'em_divida' || c.billingStatus === 'atrasado') divida++;
    });
    return { activo, aExpirar, expirado, divida, pendente, total: visible };
  }

  function updateClientsNavBadge(stats) {
    const btn = document.querySelector('.admin-tabs button[data-panel="clients"]');
    if (!btn) return;
    let badge = btn.querySelector('.nav-badge');
    const n = (stats.divida || 0) + (stats.expirado || 0);
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  function findDuplicatePhone(phone, excludeId) {
    const n = normalizePhone(phone);
    if (!n || n.length < 6) return null;
    return (store.clients || []).find(c => {
      if (excludeId && c.id === excludeId) return false;
      if (isInTrash(c) || c.membershipStatus === 'arquivado') return false;
      return normalizePhone(c.phone) === n;
    }) || null;
  }

  function clientMatchesAgeFilter(c, ageFilter) {
    if (!ageFilter) return true;
    const age = c.age != null && c.age !== '' ? Number(c.age) : null;
    if (ageFilter === 'none') return age == null || Number.isNaN(age);
    if (age == null || Number.isNaN(age)) return false;
    const parts = String(ageFilter).split('-');
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    if (Number.isNaN(min) || Number.isNaN(max)) return true;
    return age >= min && age <= max;
  }

  function getVisibleClients() {
    const raw = store.clients || [];
    let items = raw.map(enrichClient);
    items = items.filter(c => clientMatchesFilter(c, clientsFilter));
    items = items.filter(c => clientMatchesSearch(c, clientsSearch));
    items = items.filter(c => clientMatchesAgeFilter(c, clientsAgeFilter));
    return sortClients(items, clientsSort);
  }

  function daysPillHtml(days) {
    if (days === null || days === undefined) return '';
    if (days < 0) return '<span class="days-pill danger">há ' + Math.abs(days) + ' d</span>';
    if (days === 0) return '<span class="days-pill danger">vence hoje</span>';
    if (days <= 7) return '<span class="days-pill warn">' + days + ' dia(s)</span>';
    if (days <= 14) return '<span class="days-pill warn">' + days + ' dia(s)</span>';
    return '<span class="days-pill ok">' + days + ' dia(s)</span>';
  }

  function renderClients() {
    const list = $('#clientsList');
    if (!list) return;
    const raw = store.clients || [];
    const allEnriched = raw.map(enrichClient);
    const stats = clientsStats(allEnriched);
    updateClientsNavBadge(stats);

    const summary = $('#clientsSummary');
    if (summary) {
      summary.innerHTML = `
        <div class="stat ok"><strong>${stats.activo}</strong><span>Activos</span></div>
        <div class="stat warn"><strong>${stats.aExpirar}</strong><span>A expirar (7d)</span></div>
        <div class="stat danger"><strong>${stats.expirado}</strong><span>Expirados</span></div>
        <div class="stat danger"><strong>${stats.divida}</strong><span>Em dívida</span></div>
        <div class="stat neutral"><strong>${stats.pendente}</strong><span>Pendentes</span></div>
      `;
    }

    const filtered = getVisibleClients();
    if (!raw.length) {
      if (lastOpsLoadError) {
        const detail =
          lastOpsLoadError === 'timeout'
            ? 'O servidor não respondeu a tempo (rede lenta ou bloqueada).'
            : 'Não foi possível contactar o servidor.';
        list.innerHTML =
          '<div class="clients-empty">' +
          '<strong>Clientes não carregaram.</strong> ' +
          detail +
          ' Tente outra rede (ex. hotspot) ou recarregue a página.' +
          '</div>';
      } else {
        list.innerHTML =
          '<div class="clients-empty">Nenhum cliente ainda. Surgem automaticamente das inscrições ou adicione com <strong>+ Cliente</strong>.</div>';
      }
      updateBulkBar('clients');
      return;
    }
    if (!filtered.length) {
      list.innerHTML = `
        <div class="clients-empty">
          Nenhum cliente neste filtro${clientsSearch ? ' / pesquisa' : ''}.
          <br><button type="button" id="clearClientFiltersBtn">Limpar filtros</button>
        </div>`;
      $('#clearClientFiltersBtn')?.addEventListener('click', () => {
        clientsFilter = 'all';
        clientsSearch = '';
        clientsAgeFilter = '';
        const search = $('#clientSearch');
        if (search) search.value = '';
        const ageSel = $('#clientAgeFilter');
        if (ageSel) ageSel.value = '';
        $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === 'all');
        });
        renderClients();
      });
      updateBulkBar('clients');
      return;
    }

    // Compact row action icons (title + aria-label keep meaning for staff)
    const ICO = {
      renew: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.2"/><path d="M21 3v6h-6"/></svg>',
      wa: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.15 6.4 2.15 11.84c0 2.08.62 4.02 1.7 5.63L2 22l4.7-1.53a9.86 9.86 0 0 0 5.34 1.55c5.46 0 9.89-4.4 9.89-9.84C21.93 6.4 17.5 2 12.04 2zm5.75 13.99c-.24.67-1.38 1.23-1.9 1.31-.49.07-1.1.1-1.78-.11-.41-.13-.94-.3-1.62-.59-2.85-1.23-4.7-4.1-4.84-4.29-.14-.19-1.15-1.53-1.15-2.92 0-1.39.73-2.07.99-2.36.26-.29.57-.36.76-.36h.55c.18 0 .41-.07.64.49.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.19-.14.31-.29.48-.14.17-.31.38-.44.51-.14.14-.29.29-.12.56.16.28.73 1.2 1.56 1.94 1.08.96 1.98 1.26 2.26 1.4.28.14.45.12.61-.07.17-.19.71-.83.9-1.11.19-.28.38-.23.64-.14.26.1 1.66.78 1.95.92.28.14.47.21.54.33.07.12.07.67-.17 1.34z"/></svg>',
      edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      more: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'
    };

    list.innerHTML = filtered.map(c => {
      const days = c._daysLeft;
      const bill = c.billingStatus || 'em_dia';
      const mem = c.membershipStatus || 'pendente';
      const isDebt = bill === 'em_divida' || c._expired;
      const isExpiring = c._expiringSoon && !c._expired;
      const rowClass = isDebt ? 'client-row row-debt' : (isExpiring ? 'client-row row-expiring' : 'client-row');
      const price = c.price != null && c.price !== ''
        ? Number(c.price).toLocaleString('pt') + ' Kz'
        : '';
      const wa = whatsappUrl(c.phone);
      const contactBits = [c.phone, c.email, c.area].filter(Boolean).map(escapeHtml).join(' · ');
      const periodDates = (c.planStart || c.planEnd)
        ? escapeHtml(formatDatePT(c.planStart) + ' → ' + formatDatePT(c.planEnd))
        : '';
      const needsAttention = isDebt || isExpiring;
      const photoUrl = c.photoUrl ? String(c.photoUrl) : '';
      const initials = clientInitials(c.name);
      const avatarHtml = photoUrl
        ? `<button type="button" class="row-avatar has-photo" data-photo-open="${escapeHtml(photoUrl)}" data-photo-name="${escapeHtml(c.name || '')}" title="Ver foto" aria-label="Ver foto de ${escapeHtml(c.name || 'cliente')}">
             <img src="${escapeHtml(photoUrl)}" alt="" loading="lazy">
           </button>`
        : `<button type="button" class="row-avatar" data-edit-cli="${c.id}" title="Editar cliente" aria-label="Editar ${escapeHtml(c.name || 'cliente')}">
             <span class="row-avatar-initials">${escapeHtml(initials)}</span>
           </button>`;

      const btnRenew = isInTrash(c)
        ? ''
        : `<button type="button" class="icon-btn btn-renew" data-renew-cli="${c.id}" title="Renovar" aria-label="Renovar">${ICO.renew}</button>`;
      const btnWa = wa
        ? `<a class="icon-btn wa-btn" href="${wa}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">${ICO.wa}</a>`
        : '';
      const btnEdit = isInTrash(c)
        ? ''
        : `<button type="button" class="icon-btn" data-edit-cli="${c.id}" title="Editar" aria-label="Editar">${ICO.edit}</button>`;
      const btnRestore = isInTrash(c)
        ? `<button type="button" class="icon-btn btn-restore" data-restore-cli="${c.id}" title="Restaurar cliente" aria-label="Restaurar" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7">↩</button>`
        : '';

      const secondaryButtons = isInTrash(c)
        ? `
        <button type="button" data-restore-cli="${c.id}">Restaurar</button>
        <button type="button" class="danger" data-del-cli="${c.id}" data-purge="1">Apagar já</button>
      `
        : `
        <button type="button" data-edit-cli="${c.id}">Editar</button>
        ${mem !== 'suspenso' && mem !== 'arquivado' ? '<button type="button" data-status-cli="' + c.id + '" data-status-v="suspenso">Suspender</button>' : ''}
        ${mem === 'suspenso' || mem === 'arquivado' ? '<button type="button" data-status-cli="' + c.id + '" data-status-v="activo">Reactivar</button>' : ''}
        ${mem !== 'arquivado' ? '<button type="button" data-archive-cli="' + c.id + '">Arquivar</button>' : ''}
        <button type="button" class="danger" data-del-cli="${c.id}">Lixeira</button>
      `;

      return `
        <div class="${rowClass}">
          <div class="row-check">
            <input type="checkbox" class="bulk-item" data-list="clients" data-id="${escapeHtml(c.id)}" aria-label="Seleccionar ${escapeHtml(c.name || '')}">
          </div>
          <div class="row-main">
            <div class="row-identity">
              ${avatarHtml}
              <div class="row-identity-text">
                <span class="row-name" data-edit-cli="${c.id}" title="Editar">${c.memberNumber != null ? '<span class="member-n">Nº ' + escapeHtml(String(c.memberNumber)) + '</span> ' : ''}${escapeHtml(c.name || '—')}</span>
                <span class="row-badges">
                  <span class="status-badge status-${mem}">${mem}</span>
                  <span class="status-badge status-${bill}">${bill.replace('_', ' ')}</span>
                  ${isExpiring ? '<span class="status-badge status-a_expirar">a expirar</span>' : ''}
                  ${c.hasCard === 'sim' ? '<span class="status-badge status-card">cartão</span>' : ''}
                  ${(() => {
                    const mn = (trainingsSummaryCache && trainingsSummaryCache.monthByClient && trainingsSummaryCache.monthByClient[c.id]) || 0;
                    return '<span class="status-badge status-train" title="Treinos neste mês">' + mn + '× mês</span>';
                  })()}
                </span>
                <div class="row-contact">${[contactBits, c.schedule ? 'Horário ' + escapeHtml(c.schedule) : '', c.age != null ? 'Idade ' + escapeHtml(String(c.age)) : ''].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            </div>
          </div>
          <div class="row-plan">
            <div class="plan-name">${escapeHtml(c.planName || c.planId || 'Sem plano')}</div>
            <div class="plan-meta">${[price, c.billingCycle].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          </div>
          <div class="row-period">
            ${periodDates ? '<span class="period-dates">' + periodDates + '</span>' : ''}
            ${daysPillHtml(days)}
          </div>
          <div class="row-actions">
            ${isInTrash(c)
              ? (btnRestore + btnWa)
              : (needsAttention ? btnRenew + btnWa : btnEdit + btnRenew + btnWa) + (needsAttention ? btnEdit : '')}
            <details class="row-more">
              <summary class="icon-btn" title="Mais acções" aria-label="Mais acções">${ICO.more}</summary>
              <div class="more-menu">
                ${secondaryButtons}
              </div>
            </details>
          </div>
          ${c.notes ? '<div class="row-notes">' + escapeHtml(c.notes) + '</div>' : ''}
          ${renderDocChips(clientAttachments(c))}
        </div>`;
    }).join('');

    list.querySelectorAll('[data-edit-cli]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openClientModal(btn.dataset.editCli);
      });
    });
    list.querySelectorAll('[data-photo-open]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPhotoLightbox(btn.getAttribute('data-photo-open'), btn.getAttribute('data-photo-name') || '');
      });
    });
    list.querySelectorAll('[data-renew-cli]').forEach(btn => {
      btn.addEventListener('click', () => quickRenewClient(btn.dataset.renewCli));
    });
    list.querySelectorAll('[data-status-cli]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existing = (store.clients || []).find(x => x.id === btn.dataset.statusCli);
        if (!existing) return;
        const v = btn.dataset.statusV;
        const data = enrichClient(Object.assign({}, existing, {
          membershipStatus: v,
          billingStatus: v === 'activo' ? (existing.billingStatus === 'em_divida' ? existing.billingStatus : 'em_dia') : existing.billingStatus
        }));
        await adminAction('update_client', data);
        toast(v === 'activo' ? 'Cliente reactivado' : 'Cliente suspenso');
      });
    });
    list.querySelectorAll('[data-archive-cli]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existing = (store.clients || []).find(x => String(x.id) === String(btn.dataset.archiveCli));
        if (!existing) return;
        if (!(await adminConfirm(
          'Arquivar ' + (existing.name || 'este cliente') + '? Pode reactivar depois no filtro Arquivados.',
          { title: 'Arquivar cliente', confirmLabel: 'Arquivar' }
        ))) return;
        const ok = await adminAction('delete_client', { id: existing.id, hard: false });
        if (ok) toast('Cliente arquivado');
      });
    });
    list.querySelectorAll('[data-del-cli]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existing = (store.clients || []).find(x => String(x.id) === String(btn.dataset.delCli));
        if (!existing) return;
        const purge = btn.getAttribute('data-purge') === '1';
        if (purge) {
          if (!(await adminConfirm(
            'Apagar definitivamente ' + (existing.name || 'este cliente') + '?\nJá não poderá restaurar.',
            { title: 'Apagar cliente', confirmLabel: 'Apagar já', danger: true }
          ))) return;
          const ok = await adminAction('delete_client', { id: existing.id, hard: true, purge: true });
          if (ok) toast('Cliente apagado definitivamente');
        } else {
          if (!(await adminConfirm(
            'Mover ' + (existing.name || 'este cliente') + ' para a lixeira?\nPode restaurar nos próximos 30 dias. (Prefira Arquivar se só quiser esconder da lista principal.)',
            { title: 'Lixeira', confirmLabel: 'Mover para lixeira', danger: true }
          ))) return;
          const ok = await adminAction('delete_client', { id: existing.id, hard: true });
          if (ok) toast('Cliente na lixeira (30 dias)');
        }
      });
    });
    list.querySelectorAll('[data-restore-cli]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existing = (store.clients || []).find(x => String(x.id) === String(btn.dataset.restoreCli));
        if (!existing) return;
        const ok = await adminAction('restore_client', { id: existing.id });
        if (ok) toast('Cliente restaurado');
      });
    });
    // Close "Mais" menus when clicking outside
    list.querySelectorAll('.row-more').forEach(d => {
      d.addEventListener('toggle', () => {
        if (d.open) {
          list.querySelectorAll('.row-more').forEach(other => {
            if (other !== d) other.open = false;
          });
        }
      });
    });
    bindBulkItemChecks('clients');
    restoreBulkSelection('clients');
    updateBulkBar('clients');
  }

  /** paidAt (new) or date (legacy import) — always prefer newest-first elsewhere */
  function paymentAt(p) {
    if (!p) return '';
    return String(p.paidAt || p.date || '');
  }

  function sortPaymentsNewestFirst(list) {
    return (list || []).slice().sort((a, b) => String(paymentAt(b)).localeCompare(String(paymentAt(a))));
  }

  function formatPaymentWhen(p) {
    const at = paymentAt(p);
    if (!at) return '';
    return at.length > 12 ? formatDateTimeAO(at) : formatDatePT(at.slice(0, 10));
  }

  function renderPayHistory(payments) {
    const el = $('#cPayHistory');
    if (!el) return;
    const list = sortPaymentsNewestFirst(payments);
    if (!list.length) {
      el.innerHTML = '<li style="color:#999">Ainda sem pagamentos registados.</li>';
      return;
    }
    const methodLabel = { cash: 'Numerário', transfer: 'Transferência', multicaixa: 'Multicaixa', other: 'Outro' };
    el.innerHTML = list.slice(0, 40).map((p, idx) => {
      const when = formatPaymentWhen(p);
      const amt = p.amount != null ? Number(p.amount).toLocaleString('pt') + ' Kz' : '';
      const method = methodLabel[p.method] || p.method || '';
      const note = p.note ? ' — ' + escapeHtml(p.note) : '';
      const pid = p.id || ('idx-' + idx);
      const methodBit = method ? ' · ' + escapeHtml(method) : '';
      const whenBit = when ? ' · ' + escapeHtml(when) : '';
      return `<li class="pay-row" data-pay-id="${escapeHtml(String(pid))}" data-pay-idx="${idx}">
        <span class="pay-info"><strong>${amt}</strong>${methodBit}${whenBit}${note}</span>
        <span class="pay-actions">
          <button type="button" class="pay-icon-btn" data-pay-edit="${escapeHtml(String(pid))}" title="Editar" aria-label="Editar pagamento">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="pay-icon-btn pay-icon-danger" data-pay-del="${escapeHtml(String(pid))}" title="Apagar" aria-label="Apagar pagamento">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </span>
      </li>`;
    }).join('');

    el.querySelectorAll('[data-pay-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editPayment(btn.getAttribute('data-pay-edit'));
      });
    });
    el.querySelectorAll('[data-pay-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deletePayment(btn.getAttribute('data-pay-del'));
      });
    });
  }

  function findPaymentIndex(payments, payId) {
    if (!payments || !payments.length) return -1;
    let idx = payments.findIndex(p => String(p.id) === String(payId));
    if (idx >= 0) return idx;
    // fallback for older payments without id — idx is relative to newest-first order
    if (String(payId).startsWith('idx-')) {
      const n = Number(String(payId).slice(4));
      const sorted = sortPaymentsNewestFirst(payments);
      if (!Number.isNaN(n) && n >= 0 && n < sorted.length) {
        const target = sorted[n];
        const byRef = payments.indexOf(target);
        if (byRef >= 0) return byRef;
        return payments.findIndex(p =>
          paymentAt(p) === paymentAt(target) &&
          Number(p.amount) === Number(target.amount) &&
          String(p.note || '') === String(target.note || '')
        );
      }
    }
    return -1;
  }

  async function deletePayment(payId) {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    const payments = (existing.payments || []).slice();
    const idx = findPaymentIndex(payments, payId);
    if (idx < 0) return toast('Pagamento não encontrado');
    const p = payments[idx];
    const whenLabel = formatPaymentWhen(p);
    const label = (p.amount != null ? Number(p.amount).toLocaleString('pt') + ' Kz' : 'pagamento') +
      (whenLabel ? ' · ' + whenLabel : '');
    if (!(await adminConfirm('Apagar este pagamento?\n' + label, {
      title: 'Apagar pagamento', confirmLabel: 'Apagar', danger: true
    }))) return;
    payments.splice(idx, 1);
    const sortedLeft = sortPaymentsNewestFirst(payments);
    const data = enrichClient(Object.assign({}, existing, {
      payments: sortedLeft.slice(0, 50),
      lastPaymentAt: paymentAt(sortedLeft[0]) || null
    }));
    await adminAction('update_client', data);
    toast('Pagamento apagado');
    openClientModal(editingClientId);
  }

  /** Build paidAt ISO from #cPayDate (YYYY-MM-DD). Empty → now. Uses Angola civil day. */
  function paidAtFromForm() {
    const raw = ($('#cPayDate') && $('#cPayDate').value) || '';
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date().toISOString();
    const today = todayISO();
    if (raw === today) return new Date().toISOString();
    // Past/future calendar day: noon in Angola so the displayed date is stable
    return angolaDateTimeISO(raw, '12:00');
  }

  let _payEditCtx = null; // { payId, clientId }

  function closePayEditModal() {
    const modal = $('#payEditModal');
    if (modal) modal.classList.remove('open');
    _payEditCtx = null;
  }

  function openPayEditModal(payId) {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    const payments = existing.payments || [];
    const idx = findPaymentIndex(payments, payId);
    if (idx < 0) return toast('Pagamento não encontrado');
    const p = payments[idx];
    _payEditCtx = { payId: p.id || payId, clientId: editingClientId, idx: idx };

    if ($('#payEditAmount')) $('#payEditAmount').value = p.amount != null ? p.amount : '';
    if ($('#payEditMethod')) {
      const m = p.method || 'cash';
      $('#payEditMethod').value = ['cash', 'transfer', 'multicaixa', 'other'].includes(m) ? m : 'other';
    }
    if ($('#payEditDate')) {
      const at = paymentAt(p);
      $('#payEditDate').value = at
        ? (at.length > 12 ? toLocalDateAndTime(at).date : at.slice(0, 10))
        : todayISO();
    }
    if ($('#payEditNote')) $('#payEditNote').value = p.note || '';

    const modal = $('#payEditModal');
    if (modal) modal.classList.add('open');
    setTimeout(() => { try { $('#payEditAmount') && $('#payEditAmount').focus(); } catch (_) {} }, 40);
  }

  async function savePayEditModal() {
    if (!_payEditCtx || !editingClientId) return closePayEditModal();
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return closePayEditModal();
    const payments = (existing.payments || []).slice();
    const idx = findPaymentIndex(payments, _payEditCtx.payId);
    if (idx < 0) {
      toast('Pagamento não encontrado');
      return closePayEditModal();
    }
    const p = payments[idx];
    const amount = Number($('#payEditAmount') && $('#payEditAmount').value);
    if (Number.isNaN(amount) || amount < 0) return toast('Valor inválido');
    const method = ($('#payEditMethod') && $('#payEditMethod').value) || 'cash';
    const dateRaw = ($('#payEditDate') && $('#payEditDate').value) || '';
    let paidAt = p.paidAt || new Date().toISOString();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      paidAt = dateRaw === todayISO()
        ? new Date().toISOString()
        : angolaDateTimeISO(dateRaw, '12:00');
    }
    const note = ($('#payEditNote') && $('#payEditNote').value.trim()) || '';

    payments[idx] = Object.assign({}, p, {
      id: p.id || ('pay-' + Date.now() + '-' + idx),
      amount: amount,
      method: method,
      note: note,
      paidAt: paidAt,
      date: paidAt.slice(0, 10) // keep legacy field in sync
    });
    const sorted = sortPaymentsNewestFirst(payments);

    const data = enrichClient(Object.assign({}, existing, {
      payments: sorted.slice(0, 50),
      lastPaymentAt: paymentAt(sorted[0]) || existing.lastPaymentAt || null
    }));
    closePayEditModal();
    await adminAction('update_client', data);
    toast('Pagamento actualizado');
    openClientModal(editingClientId);
  }

  function editPayment(payId) {
    openPayEditModal(payId);
  }

  $('#closePayEditModal')?.addEventListener('click', closePayEditModal);
  $('#payEditCancel')?.addEventListener('click', closePayEditModal);
  $('#payEditSave')?.addEventListener('click', () => { savePayEditModal(); });
  $('#payEditModal')?.addEventListener('click', (e) => {
    if (e.target === $('#payEditModal')) closePayEditModal();
  });

  $('#closeTrainingEditModal')?.addEventListener('click', closeTrainingEditModal);
  $('#trainingEditCancel')?.addEventListener('click', closeTrainingEditModal);
  $('#trainingEditSave')?.addEventListener('click', () => { saveTrainingEditModal(); });
  $('#trainingEditModal')?.addEventListener('click', (e) => {
    if (e.target === $('#trainingEditModal')) closeTrainingEditModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#trainingEditModal') && $('#trainingEditModal').classList.contains('open')) {
      closeTrainingEditModal();
    }
  });

  function updateDupWarn(phone, excludeId) {
    const el = $('#cDupWarn');
    if (!el) return;
    const dup = findDuplicatePhone(phone, excludeId);
    if (dup) {
      el.style.display = '';
      el.textContent = 'Já existe um cliente com este telefone: ' + (dup.name || dup.phone) + '. Confirme se não é duplicado.';
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  }

  /** Parse legacy notes dump: "Nº 1344 · Horário 18:00 · Cartão: SIM · Idade 23 · …" */
  function parseClientNotesMeta(notes) {
    const out = {
      memberNumber: null,
      schedule: '',
      hasCard: '',
      age: null,
      goals: '',
      medicalConditions: '',
      cleanedNotes: notes || ''
    };
    if (!notes) return out;
    let rest = String(notes);

    const nMatch = rest.match(/(?:^|[·|]\s*)N[ºo°.]?\s*(\d+)/i);
    if (nMatch) out.memberNumber = Number(nMatch[1]);

    const hMatch = rest.match(/(?:^|[·|]\s*)Hor[aá]rio\s+([0-2]?\d:[0-5]\d)/i);
    if (hMatch) out.schedule = hMatch[1].length === 4 ? '0' + hMatch[1] : hMatch[1];

    const cMatch = rest.match(/(?:^|[·|]\s*)Cart[aã]o:\s*([^\s·|]+)/i);
    if (cMatch) {
      const v = cMatch[1].toLowerCase();
      if (v === 'sim' || v === 's' || v === 'yes') out.hasCard = 'sim';
      else if (v === 'n' || v === 'nao' || v === 'não' || v === 'sem' || v === 'no') out.hasCard = 'nao';
    }

    const aMatch = rest.match(/(?:^|[·|]\s*)Idade\s+(\d{1,3})/i);
    if (aMatch) out.age = Number(aMatch[1]);

    // Extract structured goals / medical lines (from enrollment promote or legacy text)
    const goalsMatch = rest.match(/(?:^|\n)\s*(?:Objectivos?(?:\s+de\s+treino)?|Objetivos?(?:\s+de\s+treino)?)\s*:\s*(.+?)(?=\n\s*(?:Condi[cç][oõ]es?\s+m[eé]dicas?|M[eé]dicas?|Notas)\s*:|\n\s*\n|$)/is);
    if (goalsMatch) out.goals = goalsMatch[1].replace(/\s+/g, ' ').trim();

    const medMatch = rest.match(/(?:^|\n)\s*(?:Condi[cç][oõ]es?\s+m[eé]dicas?|M[eé]dicas?)\s*:\s*(.+?)(?=\n\s*(?:Objectivos?|Objetivos?|Notas)\s*:|\n\s*\n|$)/is);
    if (medMatch) out.medicalConditions = medMatch[1].replace(/\s+/g, ' ').trim();

    // Strip structured segments so notes stay free-text only
    rest = rest
      .replace(/(?:^|[·|]\s*)N[ºo°.]?\s*\d+/gi, '')
      .replace(/(?:^|[·|]\s*)Hor[aá]rio\s+[0-2]?\d:[0-5]\d/gi, '')
      .replace(/(?:^|[·|]\s*)Cart[aã]o:\s*[^\s·|]+/gi, '')
      .replace(/(?:^|[·|]\s*)Idade\s+\d{1,3}/gi, '')
      .replace(/(?:^|\n)\s*(?:Objectivos?(?:\s+de\s+treino)?|Objetivos?(?:\s+de\s+treino)?)\s*:.*/gi, '')
      .replace(/(?:^|\n)\s*(?:Condi[cç][oõ]es?\s+m[eé]dicas?|M[eé]dicas?)\s*:.*/gi, '')
      .replace(/(?:^|\n)\s*Notas(?:\s+ou\s+quest[oõ]es)?\s*:\s*/gi, '\n')
      .replace(/^[·|\s]+|[·|\s]+$/g, '')
      .replace(/\s*[·|]\s*[·|]\s*/g, ' · ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    out.cleanedNotes = rest;
    return out;
  }

  function setScheduleSelect(value) {
    const sel = $('#cSchedule');
    if (!sel) return;
    const v = value || '';
    if (v && !Array.from(sel.options).some(o => o.value === v)) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function populatePlanSelect(selectedId, selectedName) {
    const sel = $('#cPlanSelect');
    if (!sel) return;
    const list = (products || []).filter(p => p && p.active !== false).slice().sort((a, b) => {
      const ao = a.order != null ? a.order : 999;
      const bo = b.order != null ? b.order : 999;
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
    });
    let html = '<option value="">— Escolher plano —</option>';
    const byCat = { ginasio: [], natacao: [], other: [] };
    list.forEach(p => {
      const cat = p.category === 'ginasio' || p.category === 'natacao' ? p.category : 'other';
      byCat[cat].push(p);
    });
    const groups = [
      { key: 'ginasio', label: 'Ginásio' },
      { key: 'natacao', label: 'Natação' },
      { key: 'other', label: 'Outros' }
    ];
    groups.forEach(g => {
      if (!byCat[g.key].length) return;
      html += '<optgroup label="' + escapeHtml(g.label) + '">';
      byCat[g.key].forEach(p => {
        const price = p.price != null ? ' — ' + Number(p.price).toLocaleString('pt') + ' Kz' : '';
        html += '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name || p.id) + price + '</option>';
      });
      html += '</optgroup>';
    });
    html += '<option value="__custom">Outro (escrever nome)</option>';
    sel.innerHTML = html;

    const matchById = selectedId && list.find(p => p.id === selectedId);
    const matchByName = !matchById && selectedName
      ? list.find(p => String(p.name).toLowerCase() === String(selectedName).toLowerCase())
      : null;
    if (matchById) {
      sel.value = matchById.id;
      setPlanCustomVisible(false);
      if ($('#cPlan')) $('#cPlan').value = matchById.name || '';
    } else if (matchByName) {
      sel.value = matchByName.id;
      setPlanCustomVisible(false);
      if ($('#cPlan')) $('#cPlan').value = matchByName.name || '';
    } else if (selectedName || selectedId) {
      sel.value = '__custom';
      setPlanCustomVisible(true);
      if ($('#cPlan')) $('#cPlan').value = selectedName || selectedId || '';
    } else {
      sel.value = '';
      setPlanCustomVisible(false);
      if ($('#cPlan')) $('#cPlan').value = '';
    }
  }

  function setPlanCustomVisible(show) {
    const row = $('#cPlanCustomRow');
    if (row) row.style.display = show ? '' : 'none';
  }

  function applyPlanFromSelect() {
    const sel = $('#cPlanSelect');
    if (!sel) return;
    const v = sel.value;
    if (!v) {
      setPlanCustomVisible(false);
      return;
    }
    if (v === '__custom') {
      setPlanCustomVisible(true);
      return;
    }
    setPlanCustomVisible(false);
    const p = (products || []).find(x => x.id === v);
    if (!p) return;
    if ($('#cPlan')) $('#cPlan').value = p.name || '';
    if (p.price != null && $('#cPrice')) {
      $('#cPrice').value = p.price;
    }
    if (p.period && $('#cCycle')) {
      const period = String(p.period).toLowerCase();
      if (period === 'mensal' || period === 'trimestral' || period === 'anual' || period === 'pacote') {
        $('#cCycle').value = period;
      } else if (period === 'única' || period === 'unica') {
        $('#cCycle').value = 'pacote';
      }
    }
    // Selecting the annual product itself: treat as addon, not main plan price overwrite oddly
    if (p.id === ANNUAL_FEE_ID && $('#cAnnualFee')) {
      $('#cAnnualFee').checked = true;
    }
    suggestPlanEnd();
    updateClientStatusChips();
    syncPayAmountWithAnnual();
  }

  function suggestPlanEnd() {
    const startEl = $('#cPlanStart');
    const endEl = $('#cPlanEnd');
    const cycleEl = $('#cCycle');
    const hint = $('#cEndHint');
    if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
    if (!startEl || !endEl || !cycleEl) return;
    const start = startEl.value;
    if (!start) return;
    // Silently fill empty end date from start + cycle (no suggestion text shown)
    if (!endEl.value) {
      const cycle = cycleEl.value || 'mensal';
      const months = CYCLE_MONTHS[cycle] || 1;
      endEl.value = addMonthsISO(start, months);
    }
  }

  function membershipLabel(v) {
    const map = {
      pendente: 'Pendente', activo: 'Activo', expirado: 'Expirado',
      suspenso: 'Suspenso', cancelado: 'Cancelado', arquivado: 'Arquivado'
    };
    return map[v] || v || '';
  }

  function billingLabel(v) {
    const map = {
      em_dia: 'Em dia', em_divida: 'Em dívida', atrasado: 'Atrasado',
      isento: 'Isento', desistente: 'Desistente'
    };
    return map[v] || v || '';
  }

  function updateClientStatusChips(client) {
    const host = $('#cStatusChips');
    if (!host) return;
    const membership = ($('#cMembership') && $('#cMembership').value) || client?.membershipStatus || '';
    const billing = ($('#cBilling') && $('#cBilling').value) || client?.billingStatus || '';
    const planEnd = ($('#cPlanEnd') && $('#cPlanEnd').value) || client?.planEnd || '';
    const chips = [];

    if (membership) {
      let cls = 'is-muted';
      if (membership === 'activo') cls = 'is-ok';
      else if (membership === 'expirado' || membership === 'cancelado') cls = 'is-danger';
      else if (membership === 'suspenso' || membership === 'pendente') cls = 'is-warn';
      chips.push('<span class="c-chip ' + cls + '">' + escapeHtml(membershipLabel(membership)) + '</span>');
    }
    if (billing) {
      let cls = 'is-muted';
      if (billing === 'em_dia' || billing === 'isento') cls = 'is-ok';
      else if (billing === 'em_divida' || billing === 'atrasado') cls = 'is-danger';
      else if (billing === 'desistente') cls = 'is-warn';
      chips.push('<span class="c-chip ' + cls + '">' + escapeHtml(billingLabel(billing)) + '</span>');
    }
    if (planEnd) {
      const days = daysUntil(planEnd);
      if (days == null) {
        chips.push('<span class="c-chip is-info">Vence ' + escapeHtml(formatDatePT(planEnd)) + '</span>');
      } else if (days < 0) {
        chips.push('<span class="c-chip is-danger">Expirou há ' + Math.abs(days) + 'd</span>');
      } else if (days <= 7) {
        chips.push('<span class="c-chip is-warn">Expira em ' + days + 'd</span>');
      } else {
        chips.push('<span class="c-chip is-info">Vence ' + escapeHtml(formatDatePT(planEnd)) + '</span>');
      }
    }
    host.innerHTML = chips.join('');
  }

  function updatePayPreview() {
    const preview = $('#cPayPreview');
    if (!preview) return;
    const cycle = ($('#cCycle') && $('#cCycle').value) || 'mensal';
    const months = CYCLE_MONTHS[cycle] || 1;
    const currentEnd = ($('#cPlanEnd') && $('#cPlanEnd').value) || '';
    const start = currentEnd && daysUntil(currentEnd) >= 0 ? currentEnd : todayISO();
    const end = addMonthsISO(start, months);
    const amount = ($('#cPayAmount') && $('#cPayAmount').value) || ($('#cPrice') && $('#cPrice').value) || '';
    const amtTxt = amount !== '' ? Number(amount).toLocaleString('pt') + ' Kz · ' : '';
    preview.style.display = '';
    preview.textContent = 'Após pagar: novo fim ' + formatDatePT(end) + ' · Activo · Em dia' + (amtTxt ? ' · ' + amtTxt.trim() : '');
  }

  function setClientSectionOpen(section, open) {
    if (!section) return;
    const head = section.querySelector('.client-section-head');
    const body = section.querySelector('.client-section-body');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) {
      if (open) body.removeAttribute('hidden');
      else body.setAttribute('hidden', '');
    }
  }

  function openClientModal(id) {
    editingClientId = id || null;
    const c = id ? (store.clients || []).find(x => x.id === id) : null;
    const inTrash = !!(c && isInTrash(c));
    const title = $('#clientModalTitle');
    if (title) {
      if (inTrash) title.textContent = 'Cliente (na lixeira)';
      else if (c) title.textContent = 'Editar cliente';
      else title.textContent = 'Novo cliente';
    }
    const trashBanner = $('#cTrashBanner');
    if (trashBanner) trashBanner.style.display = inTrash ? '' : 'none';
    $('#cName').value = c?.name || '';
    $('#cPhone').value = c?.phone || '';
    $('#cEmail').value = c?.email || '';
    $('#cArea').value = c?.area || 'ginasio';

    // Structured fields — prefer real keys; fallback-parse legacy notes once
    const meta = parseClientNotesMeta(c?.notes);
    const memberNum = c?.memberNumber != null ? c.memberNumber : meta.memberNumber;
    const birthDate = c?.birthDate || null;
    let age = c?.age != null ? c.age : meta.age;
    if (birthDate) {
      const computed = ageFromBirthDate(birthDate);
      if (computed != null) age = computed;
    }
    let schedule = c?.schedule || meta.schedule || '';
    let hasCard = c?.hasCard || meta.hasCard || '';
    if (hasCard === true || hasCard === 'SIM' || hasCard === 'Sim') hasCard = 'sim';
    if (hasCard === false || hasCard === 'N' || hasCard === 'SEM' || hasCard === 'Não' || hasCard === 'Nao') hasCard = 'nao';

    $('#cMemberNumber').value = memberNum != null && memberNum !== '' ? memberNum : '';
    if ($('#cBirthDate')) $('#cBirthDate').value = birthDate || '';
    $('#cAge').value = age != null && age !== '' ? age : '';
    setScheduleSelect(schedule);
    $('#cHasCard').value = hasCard === 'sim' || hasCard === 'nao' ? hasCard : '';

    const usedNotesFallback = c && (
      (c.memberNumber == null && meta.memberNumber != null) ||
      (c.age == null && meta.age != null) ||
      (!c.schedule && meta.schedule) ||
      (!c.hasCard && meta.hasCard) ||
      (!c.goals && meta.goals) ||
      (!c.medicalConditions && meta.medicalConditions)
    );
    // Prefer structured client fields; fall back to lines embedded in notes
    if ($('#cGoals')) {
      $('#cGoals').value = (c && c.goals) || meta.goals || '';
    }
    if ($('#cMedical')) {
      $('#cMedical').value = (c && c.medicalConditions) || meta.medicalConditions || '';
    }
    $('#cNotes').value = usedNotesFallback ? meta.cleanedNotes : (c?.notes || '');
    // If structured fields exist but notes still contain the old labeled lines, clean the notes box
    if ((c && (c.goals || c.medicalConditions)) || meta.goals || meta.medicalConditions) {
      const cleaned = stripEnrollmentNoteLines($('#cNotes').value);
      // Also strip short "Objectivos:" / "Médicas:" forms
      const cleaned2 = String(cleaned || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => {
          if (!l) return false;
          const lower = l.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return !(
            lower.startsWith('objectivos') ||
            lower.startsWith('objetivos') ||
            lower.startsWith('medicas') ||
            lower.startsWith('condicoes medicas')
          );
        })
        .join('\n')
        .trim();
      if (cleaned2 !== $('#cNotes').value.trim()) $('#cNotes').value = cleaned2;
    }

    populatePlanSelect(c?.planId || '', c?.planName || '');
    $('#cPrice').value = c?.price != null ? c.price : '';
    $('#cCycle').value = c?.billingCycle || 'mensal';
    if ($('#cAnnualFee')) $('#cAnnualFee').checked = !!c?.annualFee;
    if ($('#cSwimFee')) $('#cSwimFee').checked = !!c?.swimFee;
    const extras = Array.isArray(c?.extras) ? c.extras : [];
    if ($('#cExtraAvaliacao')) $('#cExtraAvaliacao').checked = extras.includes(EXTRA_AVALIACAO_ID);
    if ($('#cExtraAvulsas')) $('#cExtraAvulsas').checked = extras.includes(EXTRA_AVULSAS_ID);
    updateClientAddonVisibility();
    $('#cPlanStart').value = c?.planStart || '';
    $('#cPlanEnd').value = c?.planEnd || '';
    $('#cMembership').value = c?.membershipStatus || 'pendente';
    $('#cBilling').value = (c?.billingStatus === 'atrasado' ? 'em_divida' : (c?.billingStatus || 'em_dia'));
    if (c?.billingStatus && !$('#cBilling').querySelector('option[value="' + c.billingStatus + '"]')) {
      const opt = document.createElement('option');
      opt.value = c.billingStatus;
      opt.textContent = c.billingStatus;
      $('#cBilling').appendChild(opt);
      $('#cBilling').value = c.billingStatus;
    }
    $('#cEmergencyName').value = c?.emergencyName || '';
    $('#cEmergencyPhone').value = c?.emergencyPhone || '';
    // Payment area defaults empty — staff fills only when registering a payment
    if ($('#cPayAmount')) $('#cPayAmount').value = '';
    if ($('#cPayMethod')) $('#cPayMethod').value = 'cash';
    if ($('#cPayNote')) $('#cPayNote').value = '';
    if ($('#cPayDate')) $('#cPayDate').value = '';
    clearAddonCheckboxes();
    if (typeof resetPayModeToNone === 'function') resetPayModeToNone();
    else {
      const none = $('#cPayModeNone');
      if (none) none.checked = true;
    }
    updatePayPreview();
    renderPayHistory(c?.payments);

    const archBtn = $('#archiveClientBtn');
    const delBtn = $('#deleteClientBtn');
    const restoreBtn = $('#restoreClientBtn');
    // In trash: show Restaurar; hide Arquivar; Apagar still available (purge from modal is separate flow)
    if (inTrash) {
      if (archBtn) archBtn.style.display = 'none';
      if (delBtn) delBtn.style.display = 'none';
      if (restoreBtn) restoreBtn.style.display = '';
    } else {
      if (archBtn) archBtn.style.display = id ? '' : 'none';
      if (delBtn) delBtn.style.display = id ? '' : 'none';
      if (restoreBtn) restoreBtn.style.display = 'none';
    }

    const qa = $('#cQuickActions');
    if (qa) qa.style.display = id ? 'flex' : 'none';

    const subLink = $('#cSubLink');
    if (subLink) {
      if (c && c.fromSubmission) {
        subLink.style.display = '';
        subLink.innerHTML = 'Ligado à inscrição <code>' + escapeHtml(c.fromSubmission) + '</code>' +
          (inTrash ? ' <span style="color:#b45309">(cliente na lixeira)</span>' : '');
      } else {
        subLink.style.display = 'none';
        subLink.innerHTML = '';
      }
    }

    // Core sections open; collapsible ones depend on content
    document.querySelectorAll('#clientModal .client-section').forEach(sec => {
      const key = sec.getAttribute('data-section');
      const isCollapsible = sec.classList.contains('is-collapsible');
      if (!isCollapsible) {
        setClientSectionOpen(sec, true);
        return;
      }
      if (key === 'registar-pagamento') {
        // Open when action is likely needed (debt / expired)
        const inDebt = c && (c.billingStatus === 'em_divida' || c.billingStatus === 'atrasado' || c._expired);
        setClientSectionOpen(sec, !!(id && inDebt));
      } else if (key === 'historico-pagamentos') {
        const hasPay = !!(c && c.payments && c.payments.length);
        setClientSectionOpen(sec, !!(id && hasPay));
      } else if (key === 'docs') {
        const n = c ? clientAttachments(c).length : 0;
        setClientSectionOpen(sec, n > 0);
      } else if (key === 'treinos') {
        setClientSectionOpen(sec, false);
      } else {
        setClientSectionOpen(sec, false);
      }
    });

    const docsHost = $('#cDocsHost');
    if (docsHost) {
      docsHost.innerHTML = renderClientDocsBlock(c);
      bindClientDocsActions();
    }
    renderClientPhoto(c);
    updateDupWarn(c?.phone || '', id);
    updateClientStatusChips(c);
    updatePayPreview();
    suggestPlanEnd();

    if (id) {
      clientHistoryYear = '';
      loadClientHistory(id);
      const tHost = $('#cTrainingsHost');
      if (tHost) tHost.innerHTML = '<p class="muted" style="font-size:0.8rem">A carregar treinos…</p>';
    } else {
      const th = $('#cHistoryHost');
      if (th) th.innerHTML = '';
      const tHost = $('#cTrainingsHost');
      if (tHost) tHost.innerHTML = '';
    }

    const modal = $('#clientModal');
    modal.classList.add('open');
    const scroll = modal.querySelector('.client-modal-scroll') || modal;
    if (scroll) scroll.scrollTop = 0;
    modal.scrollTop = 0;
  }

  function readClientForm(existing) {
    const priceVal = $('#cPrice').value;
    const memberRaw = $('#cMemberNumber') && $('#cMemberNumber').value;
    const ageRaw = $('#cAge') && $('#cAge').value;
    const scheduleVal = ($('#cSchedule') && $('#cSchedule').value) || '';
    const hasCardVal = ($('#cHasCard') && $('#cHasCard').value) || '';
    const planSel = ($('#cPlanSelect') && $('#cPlanSelect').value) || '';
    let planId = existing?.planId || '';
    let planName = ($('#cPlan') && $('#cPlan').value.trim()) || '';
    if (planSel && planSel !== '__custom') {
      planId = planSel;
      const p = (products || []).find(x => x.id === planSel);
      if (p && p.name) planName = p.name;
    } else if (planSel === '__custom') {
      planId = existing?.planId && !((products || []).some(x => x.id === existing.planId))
        ? existing.planId
        : '';
    }
    const data = {
      id: editingClientId || ('cli-' + Date.now()),
      name: $('#cName').value.trim(),
      phone: $('#cPhone').value.trim(),
      email: $('#cEmail').value.trim(),
      area: $('#cArea').value,
      memberNumber: memberRaw === '' || memberRaw == null ? null : Number(memberRaw),
      birthDate: ($('#cBirthDate') && $('#cBirthDate').value) || existing?.birthDate || null,
      age: (() => {
        const bd = ($('#cBirthDate') && $('#cBirthDate').value) || '';
        if (bd) {
          const a = ageFromBirthDate(bd);
          if (a != null) return a;
        }
        return ageRaw === '' || ageRaw == null ? null : Number(ageRaw);
      })(),
      schedule: scheduleVal || '',
      hasCard: hasCardVal || '',
      planName: planName,
      planId: planId,
      price: priceVal === '' ? null : Number(priceVal),
      billingCycle: $('#cCycle').value,
      planStart: $('#cPlanStart').value || null,
      planEnd: $('#cPlanEnd').value || null,
      membershipStatus: $('#cMembership').value,
      billingStatus: $('#cBilling').value,
      emergencyName: ($('#cEmergencyName') && $('#cEmergencyName').value.trim()) || '',
      emergencyPhone: ($('#cEmergencyPhone') && $('#cEmergencyPhone').value.trim()) || '',
      goals: ($('#cGoals') && $('#cGoals').value.trim()) || '',
      medicalConditions: ($('#cMedical') && $('#cMedical').value.trim()) || '',
      notes: $('#cNotes').value.trim(),
      payments: existing?.payments || [],
      lastPaymentAt: existing?.lastPaymentAt || null,
      historyNotes: Array.isArray(existing?.historyNotes) ? existing.historyNotes : [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      fromSubmission: existing?.fromSubmission || null,
      fromImport: existing?.fromImport || null,
      archivedAt: existing?.archivedAt || null,
      annualFee: !!( $('#cAnnualFee') && $('#cAnnualFee').checked ),
      swimFee: !!( $('#cSwimFee') && $('#cSwimFee').checked ),
      extras: clientExtrasFromForm(),
      attachments: existing?.attachments || null,
      documents: existing?.documents || null,
      paymentProof: existing?.paymentProof || null,
      photoUrl: existing?.photoUrl || null
    };
    return enrichClient(data);
  }

  async function quickRenewClient(id) {
    const existing = (store.clients || []).find(x => x.id === id);
    if (!existing) return;
    const cycle = existing.billingCycle || 'mensal';
    const months = CYCLE_MONTHS[cycle] || 1;
    const start = existing.planEnd && daysUntil(existing.planEnd) >= 0
      ? existing.planEnd
      : todayISO();
    const end = addMonthsISO(start, months);
    const amount = existing.price != null ? Number(existing.price) : 0;
    if (!(await adminConfirm(
      'Renovar ' + (existing.name || 'cliente') + ' até ' + formatDatePT(end) + (amount ? ' (' + amount.toLocaleString('pt') + ' Kz)?' : '?'),
      { title: 'Renovar período', confirmLabel: 'Renovar' }
    ))) return;
    const payment = {
      id: 'pay-' + Date.now(),
      amount: amount,
      paidAt: new Date().toISOString(),
      method: 'cash',
      note: 'Renovação rápida',
      periodStart: start,
      periodEnd: end
    };
    const payments = (existing.payments || []).slice();
    payments.unshift(payment);
    const data = enrichClient(Object.assign({}, existing, {
      planStart: existing.planStart || start,
      planEnd: end,
      membershipStatus: 'activo',
      billingStatus: 'em_dia',
      lastPaymentAt: payment.paidAt,
      payments: payments.slice(0, 50)
    }));
    await adminAction('update_client', data);
    toast('Período renovado até ' + formatDatePT(end));
  }

  /**
   * Remove previously embedded enrollment lines from client notes so promote
   * does not duplicate Objectivos / Condições médicas / Notas.
   */
  function stripEnrollmentNoteLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => {
        if (!l) return false;
        const lower = l.toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return !(
          lower.startsWith('objectivos') ||
          lower.startsWith('objetivos') ||
          lower.startsWith('medicas') ||
          lower.startsWith('condicoes medicas') ||
          lower.startsWith('notas ou questoes') ||
          lower.startsWith('notas:') ||
          lower.startsWith('aguarda documentos')
        );
      })
      .join('\n')
      .trim();
  }

  /** Format enrollment fields with the same labels used on the public form. */
  function formatEnrollmentNotesForClient(s) {
    const lines = [];
    const goals = String((s && s.goals) || '').trim();
    const medical = String((s && s.medicalConditions) || '').trim();
    const notes = String((s && s.notes) || '').trim();
    if (goals) lines.push('Objectivos de treino: ' + goals);
    if (medical) lines.push('Condições médicas: ' + medical);
    if (notes) lines.push('Notas ou questões: ' + notes);
    return lines.join('\n');
  }

  /** Create or update client from an enrollment submission. */
  async function promoteSubmissionToClient(subId, opts) {
    const asPending = !!(opts && opts.asPending);
    const s = (store.submissions || []).find(x => x.id === subId);
    if (!s) return toast('Inscrição não encontrada');
    const phone = s.phone || '';
    let existing = null;
    if (s.fromClientId) {
      existing = (store.clients || []).find(c => c.id === s.fromClientId);
    }
    if (!existing && phone) {
      existing = findDuplicatePhone(phone, null);
    }
    const base = existing || {};
    const scheduleFromSub = Array.isArray(s.schedule) ? (s.schedule[0] || '') : (s.schedule || '');
    const pendingNote = asPending
      ? 'Aguarda documentos completos — activar quando a documentação estiver completa.'
      : '';
    // Copy enrollment documents onto the client so they appear on Clientes.
    // Prefer a full normalized list so we still work if only `documents` or
    // only `attachments` is present on the submission.
    const subAttachments = normalizeAttachments(s);
    const existingAttachments = normalizeAttachments(base);
    const mergedAttachments = (() => {
      const seen = new Set(existingAttachments.map(a => a.url));
      const out = existingAttachments.slice();
      subAttachments.forEach(a => {
        if (a.url && !seen.has(a.url)) {
          seen.add(a.url);
          out.push(a);
        }
      });
      return out;
    })();
    // Keep structured documents map when present (enrollment keys: id, medical, photo1, …)
    const mergedDocuments = (() => {
      const fromSub = (s.documents && typeof s.documents === 'object') ? s.documents : null;
      const fromBase = (base.documents && typeof base.documents === 'object') ? base.documents : null;
      if (!fromSub && !fromBase) return null;
      return Object.assign({}, fromBase || {}, fromSub || {});
    })();

    const data = enrichClient({
      id: base.id || ('cli-' + Date.now()),
      name: s.name || base.name || '',
      phone: phone || base.phone || '',
      email: s.email || base.email || '',
      area: s.area || base.area || 'ginasio',
      memberNumber: base.memberNumber != null ? base.memberNumber : null,
      birthDate: s.birthDate || base.birthDate || null,
      age: (() => {
        if (s.birthDate) {
          const a = ageFromBirthDate(s.birthDate);
          if (a != null) return a;
        }
        if (s.age != null && s.age !== '') return Number(s.age);
        if (base.birthDate) {
          const a = ageFromBirthDate(base.birthDate);
          if (a != null) return a;
        }
        return base.age != null ? base.age : null;
      })(),
      schedule: scheduleFromSub || base.schedule || '',
      hasCard: base.hasCard || '',
      planName: s.planName || friendlyPlanName(s.planIdSwim || s.planIdGym || s.planId) || base.planName || '',
      planId: s.planId || s.planIdGym || s.planIdSwim || base.planId || '',
      price: (() => {
        // Prefer monthly plan price (not total with one-off fees)
        const lines = Array.isArray(s.lineItems) ? s.lineItems : [];
        const monthly = lines.find(l => l.period === 'mensal');
        if (monthly && monthly.price != null) return Number(monthly.price);
        if (s.planIdSwim) {
          const p = (products || []).find(x => x.id === s.planIdSwim);
          if (p) return p.price;
        }
        if (s.planIdGym) {
          const p = (products || []).find(x => x.id === s.planIdGym);
          if (p) return p.price;
        }
        return s.estimatedTotal != null ? s.estimatedTotal : (base.price != null ? base.price : null);
      })(),
      billingCycle: (() => {
        const pid = s.planIdSwim || s.planIdGym || s.planId;
        const p = pid && (products || []).find(x => x.id === pid);
        if (p && p.period === 'pacote') return 'pacote';
        if (p && p.period === 'mensal') return 'mensal';
        return base.billingCycle || 'mensal';
      })(),
      // One-off fees from enrollment (not part of recurring plan price)
      annualFee: (() => {
        const a = addonsFromSubmission(s);
        return a.annualFee || !!base.annualFee;
      })(),
      swimFee: (() => {
        const a = addonsFromSubmission(s);
        return a.swimFee || !!base.swimFee;
      })(),
      extras: (() => {
        const a = addonsFromSubmission(s);
        const baseEx = Array.isArray(base.extras) ? base.extras : [];
        return Array.from(new Set(a.extras.concat(baseEx)));
      })(),
      planStart: base.planStart || todayISO(),
      planEnd: base.planEnd || addMonthsISO(todayISO(), 1),
      // Pending until all documents are provided; otherwise active
      membershipStatus: asPending ? 'pendente' : 'activo',
      billingStatus: asPending ? (base.billingStatus || 'em_dia') : (base.billingStatus || 'em_dia'),
      emergencyName: s.emergencyName || base.emergencyName || '',
      emergencyPhone: s.emergencyPhone || base.emergencyPhone || '',
      goals: String(s.goals || base.goals || '').trim(),
      medicalConditions: String(s.medicalConditions || base.medicalConditions || '').trim(),
      // Keep free-text notes only — goals / medical live in their own fields
      notes: [
        stripEnrollmentNoteLines(base.notes),
        String(s.notes || '').trim(),
        pendingNote
      ].filter(Boolean).join('\n').trim(),
      payments: base.payments || [],
      lastPaymentAt: base.lastPaymentAt || null,
      createdAt: base.createdAt || new Date().toISOString(),
      fromSubmission: s.id,
      attachments: mergedAttachments.length ? mergedAttachments : (base.attachments || null),
      documents: mergedDocuments,
      paymentProof: s.paymentProof || base.paymentProof || null,
      // Use "Foto tipo passe" from inscrição as profile photo when client has none yet
      photoUrl: base.photoUrl || profilePhotoFromEnrollment(s) || null
    });
    const ok = await adminAction('update_client', data);
    if (!ok) return;
    // Link submission; status depends on docs
    const subStatus = asPending ? 'pendente_docs' : 'inscrito';
    await adminAction('update_submission', { id: s.id, status: subStatus, fromClientId: data.id });
    toast(
      existing
        ? (asPending ? 'Cliente actualizado como pendente (docs)' : 'Cliente actualizado a partir da inscrição')
        : (asPending ? 'Cliente criado como pendente — aguarda documentos' : 'Cliente criado a partir da inscrição')
    );
    activatePanel('clients');
    openClientModal(data.id);
  }

  function exportClientsCsv() {
    const selected = getSelectedIds('clients');
    let items = getVisibleClients();
    if (selected.length) items = items.filter(c => selected.includes(c.id));
    if (!items.length) return toast('Nada para exportar');
    const headers = ['Nº', 'Nome', 'Telefone', 'Email', 'Área', 'Idade', 'Horário', 'Cartão', 'Plano', 'Preço', 'Ciclo', 'Início', 'Fim', 'Membership', 'Faturação', 'Emergência', 'Tel. emergência', 'Notas'];
    const rows = items.map(c => [
      c.memberNumber, c.name, c.phone, c.email, c.area, c.age, c.schedule, c.hasCard,
      c.planName || c.planId, c.price,
      c.billingCycle, c.planStart, c.planEnd, c.membershipStatus, c.billingStatus,
      c.emergencyName, c.emergencyPhone, c.notes
    ].map(v => {
      const s = v == null ? '' : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(','));
    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'buzios-clientes-' + todayISO() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(items.length + ' cliente(s) exportados');
  }

  /** Full backup: store (clients, inbox, newsletter) + catalog (plans, texts, images). */
  function downloadFullBackup() {
    const payload = {
      meta: {
        app: 'buzios-admin',
        version: 1,
        exportedAt: new Date().toISOString(),
        source: 'admin-backup'
      },
      store: {
        clients: (store && store.clients) || [],
        submissions: (store && store.submissions) || [],
        newsletters: (store && store.newsletters) || [],
        classes: (store && store.classes) || [],
        updatedAt: (store && store.updatedAt) || null
      },
      catalog: {
        products: products || [],
        texts: texts || { pt: {}, en: {} },
        images: images || {},
        mediaLibrary: mediaLibrary || []
      }
    };
    const nClients = payload.store.clients.length;
    const nSub = payload.store.submissions.length;
    const nNews = payload.store.newsletters.length;
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'buzios-backup-' + todayISO() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(
      'Backup: ' +
        nClients +
        ' clientes, ' +
        nSub +
        ' inscrições/contactos, ' +
        nNews +
        ' newsletter'
    );
  }

  async function copyClientPhones() {
    const selected = getSelectedIds('clients');
    let items = getVisibleClients();
    if (selected.length) items = items.filter(c => selected.includes(c.id));
    const phones = items.map(c => c.phone).filter(Boolean);
    if (!phones.length) return toast('Nenhum telefone na lista');
    try {
      await navigator.clipboard.writeText(phones.join('\n'));
      toast(phones.length + ' telefone(s) copiados' + (selected.length ? ' (seleccionados)' : ''));
    } catch (e) {
      toast('Não foi possível copiar');
    }
  }

  $('#closeClientModal')?.addEventListener('click', () => $('#clientModal').classList.remove('open'));
  $('#addClientBtn')?.addEventListener('click', () => openClientModal(null));

  // Profile photo upload / remove / enlarge
  $('#cPhotoUpload')?.addEventListener('change', async (e) => {
    const input = e.target;
    const file = input && input.files && input.files[0];
    if (!file) return;
    await uploadClientPhoto(file);
    if (input) input.value = '';
  });
  $('#cPhotoRemove')?.addEventListener('click', () => removeClientPhoto());
  $('#cPhotoAvatar')?.addEventListener('click', () => {
    const avatar = $('#cPhotoAvatar');
    if (!avatar || avatar.disabled) return;
    openPhotoLightbox(avatar.dataset.photoUrl, avatar.dataset.photoName);
  });
  $('#closePhotoLightbox')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closePhotoLightbox();
  });
  $('#photoLightbox')?.addEventListener('click', (e) => {
    // Close when tapping the dark backdrop (not the image itself)
    if (e.target === $('#photoLightbox') || e.target === $('#photoLightboxCaption')) {
      closePhotoLightbox();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#photoLightbox')?.classList.contains('open')) {
      closePhotoLightbox();
    }
  });
  $('#backupAllBtn')?.addEventListener('click', downloadFullBackup);
  $('#exportClientsBtn')?.addEventListener('click', exportClientsCsv);
  $('#copyClientPhonesBtn')?.addEventListener('click', copyClientPhones);
  $('#refreshAuditBtn')?.addEventListener('click', () => loadAuditLog());

  // Client modal: collapsible sections
  document.querySelectorAll('#clientModal .client-section-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.client-section');
      const open = btn.getAttribute('aria-expanded') !== 'true';
      setClientSectionOpen(section, open);
    });
  });

  // Plan select → fill price / cycle / custom name
  $('#cPlanSelect')?.addEventListener('change', () => applyPlanFromSelect());

  // Auto end-date suggestion + chips
  ['cPlanStart', 'cCycle'].forEach(id => {
    $('#' + id)?.addEventListener('change', () => {
      suggestPlanEnd();
      updatePayPreview();
      updateClientStatusChips();
    });
  });
  ['cPlanEnd', 'cMembership', 'cBilling'].forEach(id => {
    $('#' + id)?.addEventListener('change', () => {
      updateClientStatusChips();
      updatePayPreview();
    });
  });
  $('#cPayAmount')?.addEventListener('input', () => updatePayPreview());
  // Only push plan/addon totals into pay amount when staff is actually registering a payment
  function syncPayAmountIfPaying() {
    const mode = typeof getSelectedPayMode === 'function' ? getSelectedPayMode() : 'none';
    if (mode === 'none') {
      updatePayPreview();
      return;
    }
    syncPayAmountWithAnnual();
  }
  $('#cPrice')?.addEventListener('input', () => {
    syncPayAmountIfPaying();
  });
  ['cAnnualFee', 'cSwimFee', 'cExtraAvaliacao', 'cExtraAvulsas'].forEach(id => {
    $('#' + id)?.addEventListener('change', () => syncPayAmountIfPaying());
  });
  $('#cArea')?.addEventListener('change', () => {
    updateClientAddonVisibility();
    syncPayAmountIfPaying();
  });
  $('#cBirthDate')?.addEventListener('change', () => {
    const bd = $('#cBirthDate') && $('#cBirthDate').value;
    const a = ageFromBirthDate(bd);
    if ($('#cAge') && a != null) $('#cAge').value = a;
  });

  // Quick actions
  $('#cQaWhatsApp')?.addEventListener('click', () => {
    const phone = ($('#cPhone') && $('#cPhone').value) || '';
    const wa = whatsappUrl(phone);
    if (!wa) return toast('Telefone em falta');
    window.open(wa, '_blank', 'noopener');
  });
  $('#cQaCopyPhone')?.addEventListener('click', async () => {
    const phone = (($('#cPhone') && $('#cPhone').value) || '').trim();
    if (!phone) return toast('Telefone em falta');
    try {
      await navigator.clipboard.writeText(phone);
      toast('Telefone copiado');
    } catch (e) {
      toast('Não foi possível copiar');
    }
  });
  $('#cQaRenew')?.addEventListener('click', () => {
    const sec = $('#cPaySection');
    setClientSectionOpen(sec, true);
    const scroll = document.querySelector('#clientModal .client-modal-scroll');
    if (sec && scroll) {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    updatePayPreview();
    $('#cPayAmount')?.focus();
  });

  $('#clientSearch')?.addEventListener('input', (e) => {
    clientsSearch = e.target.value.trim();
    renderClients();
  });
  $('#clientAgeFilter')?.addEventListener('change', (e) => {
    clientsAgeFilter = e.target.value || '';
    renderClients();
  });
  $('#clientSort')?.addEventListener('change', (e) => {
    clientsSort = e.target.value || 'priority';
    renderClients();
  });
  $('#cPhone')?.addEventListener('input', (e) => {
    updateDupWarn(e.target.value, editingClientId);
  });

  $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      clientsFilter = btn.dataset.filter;
      $('#clientFilters').querySelectorAll('[data-filter]').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === clientsFilter);
      });
      renderClients();
    });
  });

  $('#inboxFilters')?.querySelectorAll('[data-inbox-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      inboxFilter = btn.dataset.inboxFilter;
      $('#inboxFilters').querySelectorAll('[data-inbox-filter]').forEach(b => {
        b.classList.toggle('active', b.dataset.inboxFilter === inboxFilter);
      });
      renderInbox();
    });
  });

  window._prodFilter = 'all';
  $('#prodFilters')?.querySelectorAll('[data-prod-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      window._prodFilter = btn.dataset.prodFilter || 'all';
      $('#prodFilters').querySelectorAll('[data-prod-filter]').forEach(b => {
        b.classList.toggle('active', b.dataset.prodFilter === window._prodFilter);
      });
      renderProducts();
    });
  });

  $('#contactsFilters')?.querySelectorAll('[data-contacts-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      contactsFilter = btn.dataset.contactsFilter || 'all';
      $('#contactsFilters').querySelectorAll('[data-contacts-filter]').forEach(b => {
        b.classList.toggle('active', b.dataset.contactsFilter === contactsFilter);
      });
      renderContacts();
    });
  });

  function getSelectedPayMode() {
    const checked = document.querySelector('input[name="cPayMode"]:checked');
    return (checked && checked.value) || 'none';
  }

  /** When staff chooses to register a payment, prefill amount/date if still empty. */
  function ensurePayFieldsForMode(mode) {
    if (!mode || mode === 'none') {
      updatePayPreview();
      return;
    }
    const payEl = $('#cPayAmount');
    if (payEl && (payEl.value === '' || payEl.value == null)) {
      const total = planPriceFromForm() + addonsTotalFromForm();
      if (total > 0) payEl.value = total;
    }
    if ($('#cPayDate') && !$('#cPayDate').value) $('#cPayDate').value = todayISO();
    updatePayPreview();
  }

  document.querySelectorAll('input[name="cPayMode"]').forEach(radio => {
    radio.addEventListener('change', () => ensurePayFieldsForMode(getSelectedPayMode()));
  });

  function resetPayModeToNone() {
    const none = $('#cPayModeNone');
    if (none) none.checked = true;
  }

  /**
   * Merge a payment into client data from the open form.
   * mode: 'only' | 'renew'
   * Mutates form fields for renew (dates/status) so read values stay consistent.
   * Returns { ok:false, error } or { ok:true, data, summary }
   */
  function buildClientDataWithPayment(existing, mode) {
    const amountStr = ($('#cPayAmount') && $('#cPayAmount').value) || '';
    const amount = amountStr === ''
      ? (existing && existing.price != null ? Number(existing.price) : 0)
      : Number(amountStr);
    if (amountStr !== '' && Number.isNaN(amount)) {
      return { ok: false, error: 'Valor de pagamento inválido' };
    }
    const paidAt = paidAtFromForm();
    const payDateLabel = (paidAt || '').slice(0, 10) || todayISO();
    const addonLabels = addonLabelsFromForm();
    let payNote = ($('#cPayNote') && $('#cPayNote').value.trim()) || '';
    if (addonLabels.length) {
      const feeLabel = addonLabels.join(' · ');
      payNote = payNote ? (payNote + ' · ' + feeLabel) : feeLabel;
    }

    if (mode === 'renew') {
      const cycle = ($('#cCycle') && $('#cCycle').value) || (existing && existing.billingCycle) || 'mensal';
      const months = CYCLE_MONTHS[cycle] || 1;
      const currentEnd = ($('#cPlanEnd') && $('#cPlanEnd').value) || (existing && existing.planEnd);
      const start = currentEnd && daysUntil(currentEnd) >= 0 ? currentEnd : todayISO();
      const end = addMonthsISO(start, months);
      if ($('#cPlanStart')) $('#cPlanStart').value = ($('#cPlanStart').value) || start;
      if ($('#cPlanEnd')) $('#cPlanEnd').value = end;
      if ($('#cMembership')) $('#cMembership').value = 'activo';
      if ($('#cBilling')) $('#cBilling').value = 'em_dia';
      clearAddonCheckboxes();
      const payment = {
        id: 'pay-' + Date.now(),
        amount: amount,
        paidAt: paidAt,
        method: ($('#cPayMethod') && $('#cPayMethod').value) || 'cash',
        note: payNote,
        periodStart: start,
        periodEnd: end,
        includesAnnualFee: !!( $('#cAnnualFee') && $('#cAnnualFee').checked ) || undefined
      };
      const payments = ((existing && existing.payments) || []).slice();
      payments.unshift(payment);
      const sortedPay = sortPaymentsNewestFirst(payments);
      const data = readClientForm(Object.assign({}, existing || {}, {
        payments: sortedPay.slice(0, 50),
        lastPaymentAt: payment.paidAt
      }));
      data.planStart = data.planStart || start;
      data.planEnd = end;
      data.membershipStatus = 'activo';
      data.billingStatus = 'em_dia';
      data.lastPaymentAt = paymentAt(sortedPay[0]) || paidAt;
      data.payments = sortedPay.slice(0, 50);
      data.billingCycle = cycle;
      data.price = planPriceFromForm() || (existing && existing.price) || null;
      data.annualFee = false;
      data.swimFee = false;
      data.extras = [];
      const amtLabel = amount ? amount.toLocaleString('pt') + ' Kz' : 'sem valor';
      return {
        ok: true,
        data: data,
        summary: 'Pagamento + renovação · ' + amtLabel + ' · válido até ' + formatDatePT(end)
      };
    }

    // mode === 'only'
    if ($('#cBilling')) $('#cBilling').value = 'em_dia';
    clearAddonCheckboxes();
    const payment = {
      id: 'pay-' + Date.now(),
      amount: amount,
      paidAt: paidAt,
      method: ($('#cPayMethod') && $('#cPayMethod').value) || 'cash',
      note: payNote,
      includesAnnualFee: !!( $('#cAnnualFee') && $('#cAnnualFee').checked ) || undefined
    };
    const payments = ((existing && existing.payments) || []).slice();
    payments.unshift(payment);
    const sortedOnly = sortPaymentsNewestFirst(payments);
    const data = readClientForm(Object.assign({}, existing || {}, {
      payments: sortedOnly.slice(0, 50),
      lastPaymentAt: paymentAt(sortedOnly[0]) || paidAt
    }));
    data.billingStatus = 'em_dia';
    data.lastPaymentAt = paymentAt(sortedOnly[0]) || paidAt;
    data.payments = sortedOnly.slice(0, 50);
    data.annualFee = false;
    data.swimFee = false;
    data.extras = [];
    const amtLabel = amount ? amount.toLocaleString('pt') + ' Kz' : 'sem valor';
    return {
      ok: true,
      data: data,
      summary: 'Pagamento registado · ' + amtLabel + ' · ' + formatDatePT(payDateLabel) + ' · em dia'
    };
  }

  async function confirmPayMode(mode, existing) {
    if (mode === 'none') return true;
    const amountStr = ($('#cPayAmount') && $('#cPayAmount').value) || '';
    const amount = amountStr === ''
      ? (existing && existing.price != null ? Number(existing.price) : 0)
      : Number(amountStr);
    const paidAt = paidAtFromForm();
    const payDateLabel = (paidAt || '').slice(0, 10) || todayISO();
    const addonLabels = addonLabelsFromForm();
    const amtLabel = amount ? amount.toLocaleString('pt') + ' Kz' : 'sem valor';
    if (mode === 'renew') {
      const cycle = ($('#cCycle') && $('#cCycle').value) || (existing && existing.billingCycle) || 'mensal';
      const months = CYCLE_MONTHS[cycle] || 1;
      const currentEnd = ($('#cPlanEnd') && $('#cPlanEnd').value) || (existing && existing.planEnd);
      const start = currentEnd && daysUntil(currentEnd) >= 0 ? currentEnd : todayISO();
      const end = addMonthsISO(start, months);
      return adminConfirm(
        'Guardar cliente com pagamento e renovação?\n\n' +
        'Valor: ' + amtLabel + '\n' +
        'Data do pagamento: ' + formatDatePT(payDateLabel) + '\n' +
        (addonLabels.length ? 'Extras: ' + addonLabels.join(' · ') + '\n' : '') +
        'Novo fim do plano: ' + formatDatePT(end) + '\n' +
        'Estado → Activo · Faturação → Em dia\n\n' +
        'Todos os outros campos do formulário também são guardados.',
        { title: 'Pagar e renovar', confirmLabel: 'Guardar' }
      );
    }
    return adminConfirm(
      'Guardar cliente e registar pagamento?\n\n' +
      'Valor: ' + amtLabel + '\n' +
      'Data: ' + formatDatePT(payDateLabel) + '\n' +
      (addonLabels.length ? 'Extras: ' + addonLabels.join(' · ') + '\n' : '') +
      'Faturação → Em dia\n' +
      'Datas do plano e membership não são alterados.\n\n' +
      'Todos os outros campos do formulário também são guardados.',
      { title: 'Registar pagamento', confirmLabel: 'Guardar' }
    );
  }

  $('#saveClientBtn')?.addEventListener('click', async () => {
    const existing = editingClientId
      ? (store.clients || []).find(x => x.id === editingClientId)
      : null;
    const payMode = getSelectedPayMode();

    // New client + payment in one go is allowed (readClientForm assigns id).
    if (!(await confirmPayMode(payMode, existing))) return;

    let data;
    let toastMsg = 'Cliente guardado';
    if (payMode === 'none') {
      data = readClientForm(existing);
    } else {
      const built = buildClientDataWithPayment(existing, payMode);
      if (!built.ok) return toast(built.error || 'Erro no pagamento');
      data = built.data;
      toastMsg = built.summary || toastMsg;
    }

    if (!data.name) return toast('Nome obrigatório');
    const dup = findDuplicatePhone(data.phone, data.id);
    if (dup && !(await adminConfirm(
      'Já existe cliente com este telefone (' + (dup.name || dup.phone) + '). Guardar na mesma?',
      { title: 'Telefone duplicado', confirmLabel: 'Guardar mesmo assim', danger: true }
    ))) return;

    const btn = $('#saveClientBtn');
    if (btn) btn.disabled = true;
    const ok = await adminAction('update_client', data);
    if (btn) btn.disabled = false;
    if (ok) {
      if ($('#cPayAmount')) $('#cPayAmount').value = '';
      if ($('#cPayNote')) $('#cPayNote').value = '';
      if ($('#cPayDate')) $('#cPayDate').value = '';
      if ($('#cPayMethod')) $('#cPayMethod').value = 'cash';
      clearAddonCheckboxes();
      resetPayModeToNone();
      updatePayPreview();
      $('#clientModal').classList.remove('open');
      toast(toastMsg);
    }
  });

  $('#archiveClientBtn')?.addEventListener('click', async () => {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => String(x.id) === String(editingClientId));
    if (!existing) return;
    if (!(await adminConfirm('Arquivar ' + (existing.name || 'este cliente') + '?', {
      title: 'Arquivar cliente', confirmLabel: 'Arquivar'
    }))) return;
    const ok = await adminAction('delete_client', { id: editingClientId, hard: false });
    if (ok) {
      $('#clientModal').classList.remove('open');
      toast('Cliente arquivado');
    }
  });

  $('#deleteClientBtn')?.addEventListener('click', async () => {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => String(x.id) === String(editingClientId));
    if (!existing) return;
    if (!(await adminConfirm(
      'Mover ' + (existing.name || 'este cliente') + ' para a lixeira?\nPode restaurar nos próximos 30 dias.\n(Prefira Arquivar se só quiser esconder da lista principal.)',
      { title: 'Lixeira', confirmLabel: 'Mover para lixeira', danger: true }
    ))) return;
    const ok = await adminAction('delete_client', { id: editingClientId, hard: true });
    if (ok) {
      $('#clientModal').classList.remove('open');
      toast('Cliente na lixeira (30 dias)');
    }
  });

  async function restoreEditingClient() {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => String(x.id) === String(editingClientId));
    if (!existing) return toast('Cliente não encontrado');
    if (!isInTrash(existing)) return toast('Cliente já não está na lixeira');
    const ok = await adminAction('restore_client', { id: editingClientId });
    if (ok) {
      toast('Cliente restaurado');
      if (clientsFilter === 'lixeira') {
        clientsFilter = 'all';
        $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === 'all');
        });
        if (typeof syncClientsBulkActionsForFilter === 'function') syncClientsBulkActionsForFilter();
      }
      openClientModal(editingClientId);
    }
  }
  $('#restoreClientBtn')?.addEventListener('click', () => restoreEditingClient());
  $('#cTrashRestoreBtn')?.addEventListener('click', () => restoreEditingClient());

  // Payment modes are handled by Guardar cliente (cPayMode radios).
  // Legacy payRenewBtn / payOnlyBtn removed from UI.

  // —— Trainings / attendance ——
  let trainingsSummaryCache = { date: '', todayByClient: {}, monthByClient: {}, daySessions: [], todayTotal: 0, monthTotal: 0 };
  let trainingsLoading = false;

  function trainingSelectedDate() {
    const el = $('#trainingDate');
    if (el && el.value) return el.value;
    return todayISO();
  }

  function shiftISODate(iso, days) {
    const base = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayISO();
    // Anchor at noon Angola so day arithmetic is stable
    const d = new Date(base + 'T12:00:00' + AO_OFFSET);
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA', { timeZone: AO_TZ });
  }

  function updateTrainingDayHint() {
    const hint = $('#trainingDayHint');
    if (!hint) return;
    const date = trainingSelectedDate();
    const today = todayISO();
    if (date === today) {
      hint.style.display = 'none';
      hint.textContent = '';
      return;
    }
    const label = formatDatePT(date);
    const isPast = date < today;
    hint.style.display = '';
    hint.textContent = isPast
      ? 'A ver ' + label + ' (dia passado). «+ Neste dia» regista o treino nessa data — útil se alguém esqueceu de marcar ontem.'
      : 'A ver ' + label + ' (dia futuro). Os novos registos ficam neste dia.';
  }

  async function loadTrainingsPanel() {
    const dateInput = $('#trainingDate');
    // Always show a concrete day after reload (never leave the empty dd/mm/yyyy placeholder)
    if (dateInput && !dateInput.value) dateInput.value = todayISO();
    updateTrainingDayHint();
    await refreshTrainingsSummary();
    renderTrainingsPanel();
  }

  async function refreshTrainingsSummary(opts) {
    const silent = !!(opts && opts.silent);
    const date = trainingSelectedDate();
    trainingsLoading = true;
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'trainings_summary',
          adminName: getAdminName(),
          data: { date }
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      if (data && data.ok) {
        trainingsSummaryCache = {
          date: data.date || date,
          month: data.month || date.slice(0, 7),
          todayByClient: data.todayByClient || {},
          monthByClient: data.monthByClient || {},
          daySessions: data.daySessions || [],
          todayTotal: data.todayTotal || 0,
          monthTotal: data.monthTotal || 0
        };
      } else if (!silent) {
        toast('Erro ao carregar treinos');
      }
    } catch (e) {
      console.warn('trainings_summary failed', e);
      if (!silent) {
        toast(isTimeoutError(e) ? 'Servidor não respondeu (treinos)' : 'Erro ao carregar treinos');
      }
    } finally {
      trainingsLoading = false;
    }
  }

  function renderTrainingsPanel() {
    const list = $('#trainingsList');
    const summaryEl = $('#trainingsSummary');
    if (!list) return;

    // Keep the date input filled so reload never shows an empty dd/mm/yyyy field
    const dateInput = $('#trainingDate');
    if (dateInput && !dateInput.value) dateInput.value = todayISO();

    const date = trainingSelectedDate();
    const q = (($('#trainingSearch') && $('#trainingSearch').value) || '').trim();
    const filter = ($('#trainingFilter') && $('#trainingFilter').value) || 'activo';
    const cache = trainingsSummaryCache;

    if (summaryEl) {
      const whoToday = Object.keys(cache.todayByClient || {}).length;
      summaryEl.innerHTML =
        '<span class="sum-pill"><strong>' + (cache.todayTotal || 0) + '</strong> sessões neste dia</span>' +
        '<span class="sum-pill"><strong>' + whoToday + '</strong> clientes treinam hoje</span>' +
        '<span class="sum-pill"><strong>' + (cache.monthTotal || 0) + '</strong> sessões no mês</span>' +
        (trainingsLoading ? '<span class="sum-pill muted">A actualizar…</span>' : '');
    }

    let clients = (store.clients || []).map(enrichClient).filter(c => !isInTrash(c));
    if (filter === 'activo') {
      clients = clients.filter(c => c.membershipStatus === 'activo' && !c._expired);
    } else if (filter === 'trained') {
      clients = clients.filter(c => (cache.todayByClient[c.id] || 0) > 0);
    } else if (filter === 'not_trained') {
      clients = clients.filter(c =>
        c.membershipStatus === 'activo' && !c._expired && !(cache.todayByClient[c.id] || 0)
      );
    }

    if (q) {
      clients = clients.filter(c => clientMatchesSearch(c, q));
    }

    clients.sort((a, b) => {
      const ta = cache.todayByClient[a.id] || 0;
      const tb = cache.todayByClient[b.id] || 0;
      if (tb !== ta) return tb - ta;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
    });

    if (!clients.length) {
      list.innerHTML = '<p class="empty-hint" style="color:#888;padding:1rem 0">Nenhum cliente para mostrar.</p>';
      return;
    }

    const sessionsByClient = {};
    (cache.daySessions || []).forEach(s => {
      if (!sessionsByClient[s.clientId]) sessionsByClient[s.clientId] = [];
      sessionsByClient[s.clientId].push(s);
    });

    list.innerHTML = clients.map(c => {
      const todayN = cache.todayByClient[c.id] || 0;
      const monthN = cache.monthByClient[c.id] || 0;
      const sessions = sessionsByClient[c.id] || [];
      const mem = c.membershipStatus || 'pendente';
      const sessionsHtml = sessions.length
        ? '<ul class="training-session-list">' + sessions.map(s => {
            const t = s.trainedAt ? formatTimeAO(s.trainedAt) : '';
            const by = s.recordedBy ? ' · ' + escapeHtml(s.recordedBy) : '';
            const note = s.note ? ' — ' + escapeHtml(s.note) : '';
            return '<li>' +
              '<span>' + escapeHtml(t) + by + note + '</span>' +
              '<span class="training-session-actions">' +
              '<button type="button" class="pay-icon-btn" data-edit-training="' + escapeHtml(s.id) + '" data-trained-at="' + escapeHtml(s.trainedAt || '') + '" data-note="' + escapeHtml(s.note || '') + '" title="Editar sessão" aria-label="Editar sessão">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
              '</button>' +
              '<button type="button" class="pay-icon-btn pay-icon-danger" data-del-training="' + escapeHtml(s.id) + '" title="Apagar sessão" aria-label="Apagar sessão">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
              '</button></span></li>';
          }).join('') + '</ul>'
        : '';

      const photoUrl = c.photoUrl ? String(c.photoUrl) : '';
      const av = photoUrl
        ? '<span class="row-avatar has-photo training-avatar"><img src="' + escapeHtml(photoUrl) + '" alt="" loading="lazy"></span>'
        : '<span class="row-avatar training-avatar"><span class="row-avatar-initials">' + escapeHtml(clientInitials(c.name)) + '</span></span>';
      return '<div class="training-row' + (todayN ? ' training-row--done' : '') + '" data-client-id="' + escapeHtml(c.id) + '">' +
        av +
        '<div class="training-main">' +
          '<span class="row-name" data-edit-cli="' + escapeHtml(c.id) + '">' +
            (c.memberNumber != null ? '<span class="member-n">Nº ' + escapeHtml(String(c.memberNumber)) + '</span> ' : '') +
            escapeHtml(c.name || '—') +
          '</span>' +
          '<span class="row-badges">' +
            '<span class="status-badge status-' + mem + '">' + mem + '</span>' +
            (c.schedule ? '<span class="status-badge status-card">' + escapeHtml(c.schedule) + '</span>' : '') +
          '</span>' +
          '<div class="row-contact">' + escapeHtml([c.phone, c.planName || c.planId].filter(Boolean).join(' · ') || '—') + '</div>' +
        '</div>' +
        '<div class="training-counts">' +
          '<span class="t-count" title="Sessões neste dia"><strong>' + todayN + '</strong> ' + (date === todayISO() ? 'hoje' : 'neste dia') + '</span>' +
          '<span class="t-count" title="Sessões neste mês"><strong>' + monthN + '</strong> mês</span>' +
        '</div>' +
        '<div class="training-actions">' +
          '<button type="button" class="btn-train" data-add-training="' + escapeHtml(c.id) + '" title="Registo rápido neste dia. Clique longo / Alt para escolher data, hora e nota.">' +
            (date === todayISO() ? '+ Treino' : '+ Neste dia') +
          '</button>' +
        '</div>' +
        (sessionsHtml ? '<div class="training-sessions">' + sessionsHtml + '</div>' : '') +
      '</div>';
    }).join('');

    updateTrainingDayHint();

    list.querySelectorAll('[data-add-training]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-add-training');
        // Alt/Option or Shift = open full form (date/time/note); plain click = fast register for selected day
        if (e && (e.altKey || e.shiftKey)) {
          openTrainingAddModal(id, { date: trainingSelectedDate() });
        } else {
          addTrainingForClient(id, { quick: true });
        }
      });
    });
    list.querySelectorAll('[data-del-training]').forEach(btn => {
      btn.addEventListener('click', () => deleteTrainingSession(btn.getAttribute('data-del-training')));
    });
    list.querySelectorAll('[data-edit-training]').forEach(btn => {
      btn.addEventListener('click', () => {
        editTrainingSession(btn.getAttribute('data-edit-training'), {
          trainedAt: btn.getAttribute('data-trained-at') || '',
          note: btn.getAttribute('data-note') || ''
        });
      });
    });
    list.querySelectorAll('[data-edit-cli]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openClientModal(btn.getAttribute('data-edit-cli'));
      });
    });
  }

  let _trainingAddClientId = null;

  function closeTrainingAddModal() {
    const modal = $('#trainingAddModal');
    if (modal) modal.classList.remove('open');
    _trainingAddClientId = null;
  }

  function openTrainingAddModal(clientId, opts) {
    if (!clientId) return;
    _trainingAddClientId = clientId;
    const client = (store.clients || []).find(c => String(c.id) === String(clientId));
    const label = $('#trainingAddClientLabel');
    if (label) {
      label.textContent = client
        ? ((client.memberNumber != null ? 'Nº ' + client.memberNumber + ' · ' : '') + (client.name || ''))
        : '';
    }
    const preferDate = (opts && opts.date) || trainingSelectedDate() || todayISO();
    const nowParts = toLocalDateAndTime(new Date());
    if ($('#trainingAddDate')) $('#trainingAddDate').value = preferDate;
    if ($('#trainingAddTime')) {
      // Same day as "now" → current time; other day → 12:00
      $('#trainingAddTime').value = preferDate === todayISO() ? nowParts.time : '12:00';
    }
    if ($('#trainingAddNote')) $('#trainingAddNote').value = (opts && opts.note) || '';
    const modal = $('#trainingAddModal');
    if (modal) modal.classList.add('open');
    setTimeout(() => {
      try { $('#trainingAddDate') && $('#trainingAddDate').focus(); } catch (_) {}
    }, 40);
  }

  async function saveTrainingAddModal() {
    if (!_trainingAddClientId) return closeTrainingAddModal();
    const dateVal = ($('#trainingAddDate') && $('#trainingAddDate').value) || '';
    const timeVal = ($('#trainingAddTime') && $('#trainingAddTime').value) || '12:00';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      toast('Escolha a data do treino');
      return;
    }
    const timeNorm = /^\d{2}:\d{2}/.test(timeVal) ? timeVal.slice(0, 5) : '12:00';
    let trainedAt;
    try {
      trainedAt = angolaDateTimeISO(dateVal, timeNorm);
      if (!trainedAt) {
        toast('Data/hora inválida');
        return;
      }
    } catch (_) {
      toast('Data/hora inválida');
      return;
    }
    const note = ($('#trainingAddNote') && $('#trainingAddNote').value.trim()) || '';
    const clientId = _trainingAddClientId;
    closeTrainingAddModal();
    await persistNewTraining(clientId, trainedAt, note);
  }

  async function persistNewTraining(clientId, trainedAt, note) {
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'add_training',
          adminName: getAdminName(),
          data: { clientId, trainedAt, note: String(note || '').trim() }
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || 'fail');
      const day = (trainedAt || '').slice(0, 10);
      toast(day && day !== todayISO()
        ? 'Treino registado em ' + formatDatePT(day)
        : 'Treino registado');
      await refreshTrainingsSummary();
      renderTrainingsPanel();
      if (editingClientId) await loadClientTrainings(editingClientId);
    } catch (e) {
      console.warn('add_training failed', e);
      toast(isTimeoutError(e) ? 'Servidor não respondeu' : 'Erro ao registar treino');
    }
  }

  async function addTrainingForClient(clientId, opts) {
    if (!clientId) return;
    // From client card without "quick": open form so staff can pick yesterday if needed
    if (!(opts && opts.quick)) {
      openTrainingAddModal(clientId, { date: todayISO() });
      return;
    }
    const date = trainingSelectedDate();
    let trainedAt = new Date().toISOString();
    // Viewing another day → noon in Angola on that day
    if (date !== todayISO()) {
      trainedAt = angolaDateTimeISO(date, '12:00');
    }
    await persistNewTraining(clientId, trainedAt, '');
  }

  async function deleteTrainingSession(id) {
    if (!id) return;
    if (!(await adminConfirm('Apagar esta sessão de treino?', {
      title: 'Apagar treino', confirmLabel: 'Apagar', danger: true
    }))) return;
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'delete_training',
          adminName: getAdminName(),
          data: { id }
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('status ' + res.status);
      toast('Sessão apagada');
      await refreshTrainingsSummary();
      renderTrainingsPanel();
      if (editingClientId) await loadClientTrainings(editingClientId);
    } catch (e) {
      console.warn('delete_training failed', e);
      toast('Erro ao apagar sessão');
    }
  }

  let _trainingEditId = null;

  function closeTrainingEditModal() {
    const modal = $('#trainingEditModal');
    if (modal) modal.classList.remove('open');
    _trainingEditId = null;
  }

  /** Extract civil date + time in Angola from an ISO instant (or Date). */
  function toLocalDateAndTime(isoOrDate) {
    let d;
    try {
      d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    } catch (_) {
      d = new Date();
    }
    if (isNaN(d.getTime())) d = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: AO_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return {
      date: get('year') + '-' + get('month') + '-' + get('day'),
      time: get('hour') + ':' + get('minute')
    };
  }

  /** Edit date/time + note for an existing training session. */
  function editTrainingSession(id, current) {
    if (!id) return;
    const cur = current || {};
    _trainingEditId = id;
    let parts = { date: todayISO(), time: '12:00' };
    try {
      const src = cur.trainedAt || (cur.trainedDate ? cur.trainedDate + 'T12:00:00' + AO_OFFSET : null);
      if (src) parts = toLocalDateAndTime(src);
    } catch (_) {}
    if ($('#trainingEditDate')) $('#trainingEditDate').value = parts.date;
    if ($('#trainingEditTime')) $('#trainingEditTime').value = parts.time;
    if ($('#trainingEditNote')) $('#trainingEditNote').value = cur.note || '';
    const modal = $('#trainingEditModal');
    if (modal) modal.classList.add('open');
    setTimeout(() => {
      try { $('#trainingEditDate') && $('#trainingEditDate').focus(); } catch (_) {}
    }, 40);
  }

  async function saveTrainingEditModal() {
    if (!_trainingEditId) return closeTrainingEditModal();
    const dateVal = ($('#trainingEditDate') && $('#trainingEditDate').value) || '';
    const timeVal = ($('#trainingEditTime') && $('#trainingEditTime').value) || '12:00';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      toast('Escolha a data do treino');
      return;
    }
    const timeNorm = /^\d{2}:\d{2}/.test(timeVal) ? timeVal.slice(0, 5) : '12:00';
    let trainedAt;
    try {
      trainedAt = angolaDateTimeISO(dateVal, timeNorm);
      if (!trainedAt) {
        toast('Data/hora inválida');
        return;
      }
    } catch (_) {
      toast('Data/hora inválida');
      return;
    }
    const note = ($('#trainingEditNote') && $('#trainingEditNote').value.trim()) || '';
    const id = _trainingEditId;
    closeTrainingEditModal();
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'update_training',
          adminName: getAdminName(),
          data: { id, trainedAt, note: note }
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || 'fail');
      toast('Treino actualizado');
      await refreshTrainingsSummary();
      renderTrainingsPanel();
      if (editingClientId) await loadClientTrainings(editingClientId);
    } catch (e) {
      console.warn('update_training failed', e);
      toast(isTimeoutError(e) ? 'Servidor não respondeu' : 'Erro ao actualizar treino');
    }
  }

  let clientHistoryCache = { clientId: '', trainings: [], audit: [], payments: [] };
  let clientHistoryYear = '';

  async function loadClientTrainings(clientId) {
    const host = $('#cTrainingsHost');
    if (!host || !clientId) return;
    host.innerHTML = '<p class="muted" style="font-size:0.8rem">A carregar treinos…</p>';
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'get_client_history',
          adminName: getAdminName(),
          data: { clientId, limit: 400 }
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      clientHistoryCache = Object.assign({}, clientHistoryCache, {
        clientId,
        trainings: (data && data.trainings) || []
      });
      renderClientTrainingsOnly(host, clientId);
    } catch (e) {
      clientHistoryCache = Object.assign({}, clientHistoryCache, { clientId, trainings: [] });
      renderClientTrainingsOnly(host, clientId);
      host.insertAdjacentHTML('beforeend', '<p class="muted" style="font-size:0.75rem">Não foi possível carregar treinos do servidor.</p>');
    }
  }

  async function loadClientHistory(clientId) {
    const host = ensureClientHistoryHost();
    if (!host || !clientId) return;
    host.innerHTML = '<p class="muted" style="font-size:0.8rem">A carregar histórico do cliente…</p>';
    const existing = (store.clients || []).find(x => x.id === clientId);
    const payments = (existing && existing.payments) || [];
    try {
      const res = await fetchWithTimeout(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getAdminPassword(),
          action: 'get_client_history',
          adminName: getAdminName(),
          data: { clientId, limit: 300 }
        }),
        cache: 'no-store'
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      clientHistoryCache = {
        clientId,
        trainings: (data && data.trainings) || [],
        audit: (data && data.audit) || [],
        payments: payments,
        historyNotes: (existing && Array.isArray(existing.historyNotes)) ? existing.historyNotes : [],
        createdAt: existing && existing.createdAt
      };
      renderClientHistory(host, clientId);
      // Also refresh trainings panel if present
      const tHost = $('#cTrainingsHost');
      if (tHost) renderClientTrainingsOnly(tHost, clientId);
    } catch (e) {
      clientHistoryCache = {
        clientId,
        trainings: [],
        audit: [],
        payments: payments,
        historyNotes: (existing && Array.isArray(existing.historyNotes)) ? existing.historyNotes : [],
        createdAt: existing && existing.createdAt
      };
      renderClientHistory(host, clientId);
      const status = host.querySelector('.client-history-status');
      if (status) status.textContent = 'Histórico parcial (servidor indisponível).';
    }
  }

  function renderClientTrainingsOnly(host, clientId) {
    if (!host) return;
    const cache = clientHistoryCache.clientId === clientId ? clientHistoryCache : { trainings: [] };
    const trainings = (cache.trainings || []).slice().sort((a, b) =>
      String(b.trainedAt || b.trainedDate || '').localeCompare(String(a.trainedAt || a.trainedDate || ''))
    );
    const month = todayISO().slice(0, 7);
    const todayN = trainings.filter(t => t.trainedDate === todayISO()).length;
    const monthN = trainings.filter(t => (t.trainedDate || '').startsWith(month)).length;

    // Group by YYYY-MM for monthly summary
    const byMonth = {};
    trainings.forEach(t => {
      const m = (t.trainedDate || '').slice(0, 7);
      if (!m) return;
      byMonth[m] = (byMonth[m] || 0) + 1;
    });
    const monthRows = Object.keys(byMonth).sort().reverse().slice(0, 18).map(m => {
      const [y, mo] = m.split('-');
      const label = (mo || '') + '/' + (y || '');
      return '<div class="t-month-row"><span>' + escapeHtml(label) + '</span><strong>' + byMonth[m] + '×</strong></div>';
    }).join('');

    host.innerHTML =
      '<div class="client-trainings-head">' +
        '<div class="client-history-stats">' +
          '<strong>' + todayN + '</strong> hoje · <strong>' + monthN + '</strong> este mês · <strong>' + trainings.length + '</strong> no total' +
        '</div>' +
        '<button type="button" class="btn-train" id="cAddTrainingBtn" title="Registar treino em qualquer dia">+ Treino</button>' +
      '</div>' +
      (monthRows
        ? '<div class="t-month-summary"><div class="t-month-title">Por mês</div>' + monthRows + '</div>'
        : '') +
      (trainings.length
        ? '<ul class="client-training-list">' + trainings.slice(0, 80).map(t => {
            const when = t.trainedAt
              ? new Date(t.trainedAt).toLocaleString('pt', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : formatDatePT(t.trainedDate);
            const by = t.recordedBy ? ' · ' + escapeHtml(t.recordedBy) : '';
            const note = t.note ? ' — ' + escapeHtml(t.note) : '';
            return '<li>' +
              '<span class="client-training-text">' + escapeHtml(when) + by + note + '</span>' +
              '<span class="training-session-actions">' +
              '<button type="button" class="pay-icon-btn" data-edit-training="' + escapeHtml(t.id) + '" data-trained-at="' + escapeHtml(t.trainedAt || '') + '" data-note="' + escapeHtml(t.note || '') + '" title="Editar" aria-label="Editar treino">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
              '</button>' +
              '<button type="button" class="pay-icon-btn pay-icon-danger" data-del-training="' + escapeHtml(t.id) + '" title="Apagar" aria-label="Apagar treino">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
              '</button></span></li>';
          }).join('') + '</ul>'
        : '<p class="muted" style="font-size:0.85rem">Ainda sem treinos registados. Use <strong>+ Treino</strong> (pode escolher ontem) ou o painel Treinos.</p>');

    const addBtn = host.querySelector('#cAddTrainingBtn');
    if (addBtn) addBtn.addEventListener('click', () => openTrainingAddModal(clientId, { date: todayISO() }));
    host.querySelectorAll('[data-edit-training]').forEach(btn => {
      btn.addEventListener('click', () => {
        editTrainingSession(btn.getAttribute('data-edit-training'), {
          trainedAt: btn.getAttribute('data-trained-at') || '',
          note: btn.getAttribute('data-note') || ''
        });
      });
    });
    host.querySelectorAll('[data-del-training]').forEach(btn => {
      btn.addEventListener('click', () => deleteTrainingSession(btn.getAttribute('data-del-training')));
    });
  }

  function buildClientTimeline(cache, yearFilter) {
    const events = [];
    const methodLabel = { cash: 'Numerário', transfer: 'Transferência', multicaixa: 'Multicaixa', other: 'Outro' };

    sortPaymentsNewestFirst(cache.payments || []).forEach((p, idx) => {
      const at = paymentAt(p);
      const method = methodLabel[p.method] || p.method || '';
      events.push({
        at,
        sortKey: at || '1970-01-01',
        type: 'payment',
        title: 'Pagamento',
        body:
          (p.amount != null ? Number(p.amount).toLocaleString('pt') + ' Kz' : '—') +
          (method ? ' · ' + method : '') +
          (p.note ? ' — ' + p.note : '') +
          (p.periodEnd ? ' · válido até ' + formatDatePT(p.periodEnd) : ''),
        id: p.id || ('idx-' + idx),
        payId: p.id || ('idx-' + idx)
      });
    });

    // Manual notes created in Histórico do cliente
    const noteTypeLabel = { nota: 'Nota', contacto: 'Contacto', aviso: 'Aviso', outro: 'Outro' };
    (cache.historyNotes || []).forEach((n, idx) => {
      const at = n.at || '';
      events.push({
        at,
        sortKey: at || '1970-01-01',
        type: 'note',
        title: noteTypeLabel[n.type] || n.type || 'Nota',
        body: n.text || '',
        who: n.recordedBy || '',
        id: n.id || ('note-' + idx),
        noteId: n.id || ('note-idx-' + idx)
      });
    });

    // Trainings are shown only in "Histórico de treinos" — not here

    (cache.audit || []).forEach(a => {
      // Skip training add/delete noise
      if (a.entity === 'training' && (a.action === 'add_training' || a.action === 'delete_training' || a.action === 'import_trainings_bulk')) return;
      const at = a.at || '';
      const actionLabels = {
        save_client: 'Cliente actualizado',
        delete_client: 'Cliente apagado / lixeira',
        restore_client: 'Cliente restaurado',
        save_submission: 'Inscrição actualizada'
      };
      events.push({
        at,
        sortKey: at || '1970-01-01',
        type: 'audit',
        title: actionLabels[a.action] || a.action || 'Acção',
        body: (a.detail || '').replace(/^\[.*?\]\s*/, '') || '',
        who: ((a.detail || '').match(/^\[([^\]]+)\]/) || [])[1] || '',
        id: 'audit-' + a.id
      });
    });

    if (cache.createdAt) {
      events.push({
        at: cache.createdAt,
        sortKey: cache.createdAt,
        type: 'created',
        title: 'Cliente criado',
        body: '',
        id: 'created'
      });
    }

    events.sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));

    if (yearFilter) {
      return events.filter(ev => String(ev.at || '').startsWith(String(yearFilter)));
    }
    return events;
  }

  function renderClientHistory(host, clientId) {
    if (!host) return;
    const cache = clientHistoryCache.clientId === clientId ? clientHistoryCache : { trainings: [], audit: [], payments: [] };
    const years = new Set();
    buildClientTimeline(cache, '').forEach(ev => {
      const y = String(ev.at || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    });
    const yearList = Array.from(years).sort().reverse();
    if (clientHistoryYear && yearList.indexOf(clientHistoryYear) < 0) clientHistoryYear = '';

    const timeline = buildClientTimeline(cache, clientHistoryYear);

    const yearOptions =
      '<option value="">Todos os anos</option>' +
      yearList.map(y =>
        '<option value="' + y + '"' + (clientHistoryYear === y ? ' selected' : '') + '>' + y + '</option>'
      ).join('');

    const typeClass = {
      payment: 'hist-pay',
      training: 'hist-train',
      audit: 'hist-audit',
      created: 'hist-created',
      note: 'hist-note'
    };

    host.innerHTML =
      '<div class="client-history-head">' +
        '<h3>Histórico do cliente</h3>' +
        '<div class="client-history-tools">' +
          '<select id="cHistoryYear" aria-label="Filtrar por ano">' + yearOptions + '</select>' +
          '<button type="button" class="btn-train" id="cAddHistNoteBtn" title="Adicionar nota ao histórico">+ Nota</button>' +
        '</div>' +
      '</div>' +
      '<p class="client-history-stats">' +
        '<strong>' + (cache.payments || []).length + '</strong> pagamentos · ' +
        '<strong>' + (cache.historyNotes || []).length + '</strong> notas · ' +
        '<strong>' + timeline.length + '</strong> eventos' +
        (clientHistoryYear ? ' em ' + clientHistoryYear : '') +
      '</p>' +
      '<p class="client-history-status muted" style="font-size:0.75rem;min-height:1em"></p>' +
      (timeline.length
        ? '<ul class="client-history-timeline">' + timeline.map(ev => {
            const when = ev.at
              ? (ev.at.length > 12
                  ? formatDateTimeAO(ev.at)
                  : formatDatePT(ev.at.slice(0, 10)))
              : '—';
            const cls = typeClass[ev.type] || '';
            const who = ev.who ? ' · ' + escapeHtml(ev.who) : '';
            let actions = '';
            if (ev.type === 'payment' && ev.payId) {
              actions =
                '<span class="hist-actions">' +
                  '<button type="button" class="pay-icon-btn" data-hist-pay-edit="' + escapeHtml(String(ev.payId)) + '" title="Editar" aria-label="Editar pagamento">' +
                  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
                  '</button>' +
                  '<button type="button" class="pay-icon-btn pay-icon-danger" data-hist-pay-del="' + escapeHtml(String(ev.payId)) + '" title="Apagar" aria-label="Apagar pagamento">' +
                  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
                  '</button>' +
                '</span>';
            } else if (ev.type === 'note' && ev.noteId) {
              actions =
                '<span class="hist-actions">' +
                  '<button type="button" class="pay-icon-btn" data-hist-note-edit="' + escapeHtml(String(ev.noteId)) + '" title="Editar" aria-label="Editar nota">' +
                  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
                  '</button>' +
                  '<button type="button" class="pay-icon-btn pay-icon-danger" data-hist-note-del="' + escapeHtml(String(ev.noteId)) + '" title="Apagar" aria-label="Apagar nota">' +
                  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
                  '</button>' +
                '</span>';
            }
            return '<li class="hist-item ' + cls + '">' +
              '<span class="hist-dot" aria-hidden="true"></span>' +
              '<div class="hist-body">' +
                '<div class="hist-top"><span class="hist-title">' + escapeHtml(ev.title) + '</span>' +
                '<span class="hist-when">' + escapeHtml(when) + who + '</span>' + actions + '</div>' +
                (ev.body ? '<div class="hist-detail">' + escapeHtml(ev.body) + '</div>' : '') +
              '</div>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="muted" style="font-size:0.85rem">Ainda sem eventos neste filtro. Use <strong>+ Nota</strong> para registar um contacto ou observação.</p>');

    host.querySelectorAll('[data-hist-pay-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editPayment(btn.getAttribute('data-hist-pay-edit'));
      });
    });
    host.querySelectorAll('[data-hist-pay-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deletePayment(btn.getAttribute('data-hist-pay-del'));
      });
    });
    host.querySelectorAll('[data-hist-note-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHistNoteModal(btn.getAttribute('data-hist-note-edit'));
      });
    });
    host.querySelectorAll('[data-hist-note-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteHistNote(btn.getAttribute('data-hist-note-del'));
      });
    });
    const addNoteBtn = host.querySelector('#cAddHistNoteBtn');
    if (addNoteBtn) {
      addNoteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openHistNoteModal(null);
      });
    }

    const yearSel = host.querySelector('#cHistoryYear');
    if (yearSel) {
      yearSel.addEventListener('change', () => {
        clientHistoryYear = yearSel.value || '';
        renderClientHistory(host, clientId);
      });
    }
  }

  let _histNoteCtx = null; // { noteId|null }

  function closeHistNoteModal() {
    const modal = $('#histNoteModal');
    if (modal) modal.classList.remove('open');
    _histNoteCtx = null;
  }

  function openHistNoteModal(noteId) {
    if (!editingClientId) return toast('Guarde o cliente primeiro');
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    _histNoteCtx = { noteId: noteId || null };

    const notes = Array.isArray(existing.historyNotes) ? existing.historyNotes : [];
    let note = null;
    if (noteId) {
      note = notes.find(n => String(n.id) === String(noteId));
      if (!note && String(noteId).startsWith('note-idx-')) {
        const n = Number(String(noteId).slice(9));
        if (!Number.isNaN(n) && n >= 0 && n < notes.length) note = notes[n];
      }
    }

    if ($('#histNoteTitle')) {
      $('#histNoteTitle').textContent = note ? 'Editar nota' : 'Nota no histórico';
    }
    if ($('#histNoteType')) {
      const t = (note && note.type) || 'nota';
      $('#histNoteType').value = ['nota', 'contacto', 'aviso', 'outro'].includes(t) ? t : 'nota';
    }
    if ($('#histNoteText')) $('#histNoteText').value = (note && note.text) || '';

    const nowParts = toLocalDateAndTime(new Date());
    if (note && note.at) {
      const parts = toLocalDateAndTime(note.at);
      if ($('#histNoteDate')) $('#histNoteDate').value = parts.date || todayISO();
      if ($('#histNoteTime')) $('#histNoteTime').value = parts.time || '';
    } else {
      if ($('#histNoteDate')) $('#histNoteDate').value = nowParts.date || todayISO();
      if ($('#histNoteTime')) $('#histNoteTime').value = nowParts.time || '';
    }

    const modal = $('#histNoteModal');
    if (modal) modal.classList.add('open');
    setTimeout(() => { try { $('#histNoteText') && $('#histNoteText').focus(); } catch (_) {} }, 40);
  }

  async function saveHistNoteModal() {
    if (!_histNoteCtx || !editingClientId) return closeHistNoteModal();
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return closeHistNoteModal();

    const text = (($('#histNoteText') && $('#histNoteText').value) || '').trim();
    if (!text) return toast('Escreva o texto da nota');

    const type = ($('#histNoteType') && $('#histNoteType').value) || 'nota';
    const dateRaw = ($('#histNoteDate') && $('#histNoteDate').value) || todayISO();
    let timeRaw = ($('#histNoteTime') && $('#histNoteTime').value) || '';
    if (!timeRaw) {
      const nowParts = toLocalDateAndTime(new Date());
      timeRaw = nowParts.time || '12:00';
    }
    const timeNorm = timeRaw.length === 5 ? timeRaw : String(timeRaw).slice(0, 5);
    const at = angolaDateTimeISO(dateRaw, timeNorm);
    const recordedBy = getAdminName() || '';

    const notes = (Array.isArray(existing.historyNotes) ? existing.historyNotes : []).slice();
    const noteId = _histNoteCtx.noteId;

    if (noteId) {
      let idx = notes.findIndex(n => String(n.id) === String(noteId));
      if (idx < 0 && String(noteId).startsWith('note-idx-')) {
        const n = Number(String(noteId).slice(9));
        if (!Number.isNaN(n) && n >= 0 && n < notes.length) idx = n;
      }
      if (idx < 0) {
        toast('Nota não encontrada');
        return closeHistNoteModal();
      }
      const prev = notes[idx];
      notes[idx] = Object.assign({}, prev, {
        id: prev.id || ('note-' + Date.now()),
        type: type,
        text: text,
        at: at,
        recordedBy: recordedBy || prev.recordedBy || '',
        updatedAt: new Date().toISOString(),
        updatedBy: recordedBy || ''
      });
    } else {
      notes.unshift({
        id: 'note-' + Date.now(),
        type: type,
        text: text,
        at: at,
        recordedBy: recordedBy,
        createdAt: new Date().toISOString()
      });
    }

    notes.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const data = enrichClient(Object.assign({}, existing, {
      historyNotes: notes.slice(0, 100)
    }));
    closeHistNoteModal();
    await adminAction('update_client', data);
    toast(noteId ? 'Nota actualizada' : 'Nota adicionada ao histórico');
    openClientModal(editingClientId);
  }

  async function deleteHistNote(noteId) {
    if (!editingClientId || !noteId) return;
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    const notes = (Array.isArray(existing.historyNotes) ? existing.historyNotes : []).slice();
    let idx = notes.findIndex(n => String(n.id) === String(noteId));
    if (idx < 0 && String(noteId).startsWith('note-idx-')) {
      const n = Number(String(noteId).slice(9));
      if (!Number.isNaN(n) && n >= 0 && n < notes.length) idx = n;
    }
    if (idx < 0) return toast('Nota não encontrada');
    const n = notes[idx];
    const preview = (n.text || '').slice(0, 80);
    if (!(await adminConfirm('Apagar esta nota?\n' + preview, {
      title: 'Apagar nota', confirmLabel: 'Apagar', danger: true
    }))) return;
    notes.splice(idx, 1);
    const data = enrichClient(Object.assign({}, existing, { historyNotes: notes }));
    await adminAction('update_client', data);
    toast('Nota apagada');
    openClientModal(editingClientId);
  }

  $('#closeHistNoteModal')?.addEventListener('click', closeHistNoteModal);
  $('#histNoteCancel')?.addEventListener('click', closeHistNoteModal);
  $('#histNoteSave')?.addEventListener('click', () => { saveHistNoteModal(); });
  $('#histNoteModal')?.addEventListener('click', (e) => {
    if (e.target === $('#histNoteModal')) closeHistNoteModal();
  });

  function ensureClientHistoryHost() {
    let host = $('#cHistoryHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'cHistoryHost';
    host.className = 'client-history-block';
    const sectionBody = document.querySelector('#cHistorySection .client-section-body');
    if (sectionBody) sectionBody.appendChild(host);
    return host;
  }

  async function setTrainingDateAndRefresh(iso) {
    const el = $('#trainingDate');
    if (el) el.value = iso;
    updateTrainingDayHint();
    await refreshTrainingsSummary();
    renderTrainingsPanel();
    const report = $('#trainingMonthReport');
    if (report && report.classList.contains('is-open')) renderTrainingMonthReport();
  }

  $('#trainingDate')?.addEventListener('change', async () => {
    updateTrainingDayHint();
    await refreshTrainingsSummary();
    renderTrainingsPanel();
    const report = $('#trainingMonthReport');
    if (report && report.classList.contains('is-open')) renderTrainingMonthReport();
  });
  $('#trainingDayPrev')?.addEventListener('click', () => {
    setTrainingDateAndRefresh(shiftISODate(trainingSelectedDate(), -1));
  });
  $('#trainingDayNext')?.addEventListener('click', () => {
    setTrainingDateAndRefresh(shiftISODate(trainingSelectedDate(), 1));
  });
  $('#trainingDayToday')?.addEventListener('click', () => setTrainingDateAndRefresh(todayISO()));
  $('#trainingDayYesterday')?.addEventListener('click', () => setTrainingDateAndRefresh(shiftISODate(todayISO(), -1)));
  $('#trainingSearch')?.addEventListener('input', () => renderTrainingsPanel());
  $('#trainingFilter')?.addEventListener('change', () => renderTrainingsPanel());

  $('#closeTrainingAddModal')?.addEventListener('click', closeTrainingAddModal);
  $('#trainingAddCancel')?.addEventListener('click', closeTrainingAddModal);
  $('#trainingAddSave')?.addEventListener('click', () => { saveTrainingAddModal(); });
  $('#trainingAddModal')?.addEventListener('click', (e) => {
    if (e.target === $('#trainingAddModal')) closeTrainingAddModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#trainingAddModal') && $('#trainingAddModal').classList.contains('open')) {
      closeTrainingAddModal();
    }
  });

  function closeTrainingMonthReport() {
    const host = $('#trainingMonthReport');
    const list = $('#trainingsList');
    if (host) {
      host.classList.remove('is-open');
      host.setAttribute('hidden', '');
      host.innerHTML = '';
    }
    if (list) {
      list.removeAttribute('hidden');
      list.hidden = false;
    }
  }

  function renderTrainingMonthReport() {
    const host = $('#trainingMonthReport');
    const list = $('#trainingsList');
    if (!host) {
      toast('Área do relatório não encontrada');
      return;
    }
    const cache = trainingsSummaryCache || {};
    const dateVal = trainingSelectedDate();
    const month = cache.month || (dateVal && dateVal.slice(0, 7)) || todayISO().slice(0, 7);
    const counts = cache.monthByClient || {};
    const trainedIds = Object.keys(counts).filter(id => (counts[id] || 0) > 0);

    let clients = (store.clients || []).map(enrichClient).filter(c => !isInTrash(c));
    // Prefer everyone who trained this month + active members
    clients = clients.filter(c =>
      (counts[c.id] || 0) > 0 ||
      c.membershipStatus === 'activo' ||
      trainedIds.indexOf(c.id) >= 0
    );
    clients.sort((a, b) => {
      const d = (counts[b.id] || 0) - (counts[a.id] || 0);
      if (d) return d;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
    });

    const totalSessions = Object.keys(counts).reduce((s, id) => s + (Number(counts[id]) || 0), 0);
    const withTraining = clients.filter(c => (counts[c.id] || 0) > 0).length;

    const rows = clients.map(c => {
      const n = counts[c.id] || 0;
      return '<tr' + (n ? '' : ' class="is-zero"') + '>' +
        '<td>' + (c.memberNumber != null ? escapeHtml(String(c.memberNumber)) : '—') + '</td>' +
        '<td>' + escapeHtml(c.name || '—') + '</td>' +
        '<td>' + escapeHtml(c.planName || c.planId || '—') + '</td>' +
        '<td class="num">' + n + '</td>' +
        '</tr>';
    }).join('');

    host.innerHTML =
      '<div class="training-report-head">' +
        '<div>' +
          '<strong>Relatório de treinos — ' + escapeHtml(month) + '</strong>' +
          '<p class="training-report-sub">' +
            '<strong>' + totalSessions + '</strong> sessões · ' +
            '<strong>' + withTraining + '</strong> clientes com treino · ' +
            clients.length + ' na lista' +
          '</p>' +
        '</div>' +
        '<button type="button" class="btn-secondary" id="trainingReportClose">Fechar</button>' +
      '</div>' +
      (clients.length
        ? '<div class="training-report-scroll"><table class="training-report-table">' +
            '<thead><tr><th>Nº</th><th>Nome</th><th>Plano</th><th>Treinos</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>'
        : '<p class="muted" style="padding:1rem 0">Sem clientes para este mês. Verifique se os clientes estão carregados e tente de novo.</p>');

    host.classList.add('is-open');
    host.removeAttribute('hidden');
    host.hidden = false;
    if (list) {
      list.setAttribute('hidden', '');
      list.hidden = true;
    }
    host.querySelector('#trainingReportClose')?.addEventListener('click', closeTrainingMonthReport);
    // Scroll report into view (sticky header can hide it)
    try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  function exportTrainingMonthCsv() {
    const cache = trainingsSummaryCache || {};
    const dateVal = trainingSelectedDate();
    const month = cache.month || (dateVal && dateVal.slice(0, 7)) || todayISO().slice(0, 7);
    const counts = cache.monthByClient || {};
    let clients = (store.clients || []).map(enrichClient).filter(c => !isInTrash(c));
    clients.sort((a, b) => {
      const d = (counts[b.id] || 0) - (counts[a.id] || 0);
      if (d) return d;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
    });
    const headers = ['Nº', 'Nome', 'Telefone', 'Plano', 'Treinos no mês'];
    const rows = clients.map(c => [
      c.memberNumber, c.name, c.phone, c.planName || c.planId, counts[c.id] || 0
    ].map(v => {
      const s = v == null ? '' : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(','));
    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'buzios-treinos-' + month + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV do mês ' + month + ' exportado');
  }

  async function openTrainingMonthReport() {
    try {
      toast('A carregar relatório…');
      await refreshTrainingsSummary();
      renderTrainingMonthReport();
      toast('Relatório do mês aberto');
    } catch (e) {
      console.warn('month report failed', e);
      toast('Erro ao abrir relatório');
    }
  }

  // Direct binds + delegation (backup if DOM timing differs)
  document.getElementById('trainingMonthReportBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openTrainingMonthReport();
  });
  document.getElementById('trainingExportMonthBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await refreshTrainingsSummary();
      exportTrainingMonthCsv();
    } catch (err) {
      toast('Erro ao exportar CSV');
    }
  });
  document.getElementById('panel-trainings')?.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('#trainingMonthReportBtn, #trainingExportMonthBtn, #trainingReportClose');
    if (!t) return;
    if (t.id === 'trainingReportClose') {
      e.preventDefault();
      closeTrainingMonthReport();
    }
  });

  // —— Products ——
  function formatAreaLabel(area) {
    if (area === 'ginasio') return 'Ginásio';
    if (area === 'natacao') return 'Natação';
    if (area === 'ambos') return 'Ginásio + Natação';
    return area || '';
  }

  function friendlyPlanName(id) {
    if (!id) return '';
    const p = (products || []).find(x => x.id === id);
    if (p && p.name) return p.name;
    return String(id);
  }

  function renderEnrollmentLines(s) {
    const lines = Array.isArray(s.lineItems) ? s.lineItems : [];
    if (!lines.length) return '';
    const rows = lines.map(l => {
      const name = escapeHtml(l.name || friendlyPlanName(l.id) || l.id || 'Item');
      const price = l.price != null ? Number(l.price).toLocaleString('pt') + ' Kz' : '';
      const suf = l.period === 'mensal' ? '/mês' : '';
      return `<div class="meta" style="padding-left:0.35rem">• ${name}${price ? ' — ' + price + suf : ''}</div>`;
    }).join('');
    return `<div class="meta" style="margin-top:0.25rem"><strong>Itens</strong></div>${rows}`;
  }

  function productGroupKey(p) {
    const id = p.id || '';
    if (p.category === 'ginasio') {
      if (id.startsWith('plano-')) return 'gym-plans';
      return 'gym-fees';
    }
    if (p.category === 'natacao') {
      if (p.period === 'pacote' || id === 'natacao-10' || id === 'natacao-15' || id === 'natacao-25') return 'swim-ferias';
      if (id === 'natacao-inscricao') return 'swim-fee';
      if (id.startsWith('natacao-bebes-')) return 'swim-bebes';
      if (id.startsWith('natacao-especial-')) return 'swim-especial';
      if (id.startsWith('natacao-hidro-')) return 'swim-hidro';
      if (id.startsWith('natacao-mensal-')) return 'swim-adult';
      return 'swim-other';
    }
    return 'other';
  }

  const PRODUCT_GROUPS = [
    { key: 'gym-plans', title: 'Ginásio — Mensalidades' },
    { key: 'gym-fees', title: 'Ginásio — Inscrição e extras' },
    { key: 'swim-fee', title: 'Natação — Inscrição' },
    { key: 'swim-adult', title: 'Natação — Mensalidades · 6–99 anos' },
    { key: 'swim-bebes', title: 'Natação — Mensalidades · Bebés' },
    { key: 'swim-especial', title: 'Natação — Mensalidades · Especial' },
    { key: 'swim-hidro', title: 'Natação — Mensalidades · Hidroginástica' },
    { key: 'swim-ferias', title: 'Natação — Planos de férias' },
    { key: 'swim-other', title: 'Natação — Outros' },
    { key: 'other', title: 'Outros' }
  ];

  function renderProducts() {
    const list = $('#prodList');
    if (!list) return;
    const sorted = products.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const byGroup = {};
    sorted.forEach(p => {
      const g = productGroupKey(p);
      (byGroup[g] = byGroup[g] || []).push(p);
    });

    const filter = (window._prodFilter || 'all');
    let html = '';
    PRODUCT_GROUPS.forEach(g => {
      const items = byGroup[g.key] || [];
      if (!items.length) return;
      if (filter === 'ginasio' && !g.key.startsWith('gym')) return;
      if (filter === 'natacao' && !g.key.startsWith('swim')) return;
      if (filter === 'ferias' && g.key !== 'swim-ferias') return;
      if (filter === 'mensal' && !['swim-adult', 'swim-bebes', 'swim-especial', 'swim-hidro', 'gym-plans'].includes(g.key)) return;

      html += `<div class="prod-group"><h4 class="prod-group-title">${escapeHtml(g.title)} <span class="prod-group-count">${items.length}</span></h4>`;
      html += items.map(p => `
        <div class="prod-card ${p.active === false ? 'prod-inactive' : ''}">
          <h3>${escapeHtml(p.name)} ${p.featured ? '★' : ''}</h3>
          <div class="meta">${Number(p.price).toLocaleString('pt')} Kz · ${escapeHtml(p.period || '—')}${p.active === false ? ' · <em>inactivo</em>' : ''}</div>
          <div class="actions">
            <button type="button" data-edit="${escapeHtml(p.id)}">Editar</button>
            <button type="button" class="danger" data-del="${escapeHtml(p.id)}">Apagar</button>
          </div>
        </div>
      `).join('');
      html += '</div>';
    });

    list.innerHTML = html || '<p style="color:#666;font-size:0.9rem">Nenhum plano neste filtro.</p>';
    list.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openProductModal(btn.dataset.edit));
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await adminConfirm('Apagar este plano?', {
          title: 'Apagar plano', confirmLabel: 'Apagar', danger: true
        }))) return;
        products = products.filter(x => x.id !== btn.dataset.del);
        markDirty();
        renderProducts();
      });
    });
  }

  function openProductModal(id) {
    editingId = id || null;
    const p = id ? products.find(x => x.id === id) : null;
    $('#prodModalTitle').textContent = p ? 'Editar plano' : 'Novo plano';
    $('#fName').value = p?.name || '';
    $('#fNameEn').value = p?.name_en || '';
    $('#fCategory').value = p?.category || 'ginasio';
    $('#fPrice').value = p?.price ?? '';
    const periodEl = $('#fPeriod');
    if (periodEl) {
      const per = p?.period || 'mensal';
      if (periodEl.tagName === 'SELECT') {
        periodEl.value = ['mensal', 'única', 'pacote', 'cartão'].includes(per) ? per : 'mensal';
      } else {
        periodEl.value = per;
      }
    }
    $('#fDesc').value = p?.description || '';
    $('#fDescEn').value = p?.description_en || '';
    $('#fFeatures').value = (p?.features || []).join('\n');
    $('#fFeatured').checked = !!p?.featured;
    $('#fActive').checked = p ? p.active !== false : true;
    $('#prodModal').classList.add('open');
  }
  $('#closeProdModal')?.addEventListener('click', () => $('#prodModal').classList.remove('open'));
  $('#addProductBtn')?.addEventListener('click', () => openProductModal(null));
  $('#saveProdBtn')?.addEventListener('click', () => {
    const name = $('#fName').value.trim();
    if (!name) return toast('Nome obrigatório');
    const data = {
      id: editingId || ('p-' + Date.now()),
      name,
      name_en: $('#fNameEn').value.trim(),
      category: $('#fCategory').value,
      price: Number($('#fPrice').value) || 0,
      currency: 'KZ',
      period: $('#fPeriod').value.trim() || 'mensal',
      description: $('#fDesc').value.trim(),
      description_en: $('#fDescEn').value.trim(),
      features: $('#fFeatures').value.split('\n').map(s => s.trim()).filter(Boolean),
      features_en: [],
      image: '',
      featured: $('#fFeatured').checked,
      active: $('#fActive').checked,
      order: editingId ? (products.find(x => x.id === editingId)?.order || 99) : 99
    };
    if (editingId) {
      const idx = products.findIndex(x => x.id === editingId);
      if (idx >= 0) products[idx] = Object.assign({}, products[idx], data);
    } else {
      products.push(data);
    }
    markDirty();
    $('#prodModal').classList.remove('open');
    renderProducts();
    toast('Plano actualizado (ainda rascunho — publique para o site)');
  });

  // —— Images ——
  function renderImageSlots() {
    const el = $('#imgSlots');
    if (!el) return;
    el.innerHTML = SITE_IMAGE_SLOTS.map(slot => {
      const url = images[slot.key] || '';
      const picking = pendingSlotKey === slot.key;
      return `
        <div class="img-slot" data-key="${slot.key}" style="${picking ? 'outline:2px solid #c45c26;outline-offset:2px' : ''}">
          <strong style="font-size:0.85rem">${slot.label}${picking ? ' — toque numa foto da biblioteca ↓' : ''}</strong>
          ${url ? `<img src="${url}" alt="">` : '<div style="height:80px;background:#eee;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;font-size:0.8rem">Sem imagem</div>'}
          <div class="slot-actions">
            <button type="button" data-upload="${slot.key}">Carregar</button>
            <button type="button" data-pick="${slot.key}">Da biblioteca</button>
            <button type="button" data-clear="${slot.key}">Original</button>
          </div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-upload]').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingSlotKey = null;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          toast('A carregar…');
          try {
            const url = await uploadToCloudinary(file);
            images[btn.dataset.upload] = url;
            mediaLibrary.unshift({ url, name: file.name, at: Date.now() });
            markDirty();
            localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
            renderImageSlots();
            renderMediaLibrary();
            toast('Imagem carregada — publique para todos verem');
          } catch (err) {
            toast('Erro no upload: ' + (err.message || err));
          }
        };
        input.click();
      });
    });
    el.querySelectorAll('[data-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!mediaLibrary.length) {
          toast('Biblioteca vazia — carregue fotos primeiro');
          return;
        }
        pendingSlotKey = btn.dataset.pick;
        renderImageSlots();
        renderMediaLibrary();
        toast('Toque numa foto da biblioteca para atribuir');
        const lib = $('#mediaLibrary');
        if (lib) lib.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
    el.querySelectorAll('[data-clear]').forEach(btn => {
      btn.addEventListener('click', () => {
        delete images[btn.dataset.clear];
        markDirty();
        renderImageSlots();
      });
    });
  }

  function renderMediaLibrary() {
    const el = $('#mediaLibrary');
    if (!el) return;
    const picking = !!pendingSlotKey;
    el.innerHTML = mediaLibrary.map((m, i) => `
      <div style="position:relative;cursor:${picking ? 'pointer' : 'default'}" data-use="${i}" title="${picking ? 'Usar neste slot' : m.name || ''}">
        <img src="${m.url}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;${picking ? 'box-shadow:0 0 0 2px #c45c26' : ''}">
        <button type="button" data-rm="${i}" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;font-size:12px;cursor:pointer">×</button>
      </div>
    `).join('');
    el.querySelectorAll('[data-use]').forEach(wrap => {
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-rm]')) return;
        if (!pendingSlotKey) return;
        const m = mediaLibrary[Number(wrap.dataset.use)];
        if (!m) return;
        images[pendingSlotKey] = m.url;
        pendingSlotKey = null;
        markDirty();
        renderImageSlots();
        renderMediaLibrary();
        toast('Imagem atribuída — publique para todos verem');
      });
    });
    el.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        mediaLibrary.splice(Number(btn.dataset.rm), 1);
        localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
        renderMediaLibrary();
      });
    });
  }

  const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // ~12 MB soft limit

  function setUploadStatus(msg) {
    const el = $('#uploadStatus');
    if (el) el.textContent = msg || '';
  }

  async function ingestFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (!files.length) {
      toast('Seleccione ficheiros de imagem (JPG, PNG, WebP…)');
      return;
    }
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_IMAGE_BYTES) {
        toast(file.name + ' é demasiado grande (máx. ~12 MB)');
        fail++;
        continue;
      }
      setUploadStatus(`A carregar ${i + 1}/${files.length}: ${file.name}…`);
      toast(`A carregar ${i + 1}/${files.length}…`);
      try {
        const url = await uploadToCloudinary(file);
        mediaLibrary.unshift({ url, name: file.name, at: Date.now() });
        localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
        ok++;
        renderMediaLibrary();
      } catch (err) {
        fail++;
        console.error('Upload failed', file.name, err);
        toast('Erro: ' + file.name + ' — ' + (err.message || err));
      }
    }
    setUploadStatus(
      ok
        ? `${ok} imagem(ns) na biblioteca${fail ? ` · ${fail} falhou(aram)` : ''}. Atribua aos slots e publique.`
        : (fail ? 'Nenhuma imagem carregada. Verifique o preset Cloudinary ou tente de novo.' : '')
    );
    if (ok) toast(ok === 1 ? 'Imagem adicionada à biblioteca' : ok + ' imagens adicionadas à biblioteca');
  }

  const mediaInput = $('#mediaUpload');
  const uploadZone = $('#uploadZone');
  const mediaUploadBtn = $('#mediaUploadBtn');

  mediaInput?.addEventListener('change', async (e) => {
    await ingestFiles(e.target.files);
    e.target.value = '';
  });

  mediaUploadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    mediaInput?.click();
  });

  uploadZone?.addEventListener('click', (e) => {
    if (e.target === mediaUploadBtn || mediaUploadBtn?.contains(e.target)) return;
    mediaInput?.click();
  });

  uploadZone?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      mediaInput?.click();
    }
  });

  ;['dragenter', 'dragover'].forEach(ev => {
    uploadZone?.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.add('dragover');
    });
  });
  ;['dragleave', 'drop'].forEach(ev => {
    uploadZone?.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('dragover');
    });
  });
  uploadZone?.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    if (dt?.files?.length) await ingestFiles(dt.files);
  });

  async function uploadToCloudinary(file) {
    const isPdf = (file && (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf'));
    // PDFs must go through /raw/upload (or /auto); /image/upload often rejects them
    // and even when accepted, serving via /image/upload returns 401.
    const resourceType = isPdf ? 'raw' : 'image';

    async function post(withFolder) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', UPLOAD_PRESET);
      if (withFolder) fd.append('folder', CATALOG_FOLDER);
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
        { method: 'POST', body: fd }
      );
      const data = await res.json().catch(() => ({}));
      return { res, data };
    }

    // Try with folder first; some unsigned presets reject folder overrides
    let { res, data } = await post(true);
    if (!res.ok) {
      const msg = (data.error && data.error.message) || data.message || '';
      if (/folder|preset|not allowed|invalid/i.test(String(msg))) {
        ({ res, data } = await post(false));
      }
    }
    // Fallback: try auto resource type if image/raw failed (e.g. HEIC, odd MIME)
    if (!res.ok && resourceType !== 'auto') {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', UPLOAD_PRESET);
      fd.append('folder', CATALOG_FOLDER);
      try {
        const autoRes = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
          { method: 'POST', body: fd }
        );
        const autoData = await autoRes.json().catch(() => ({}));
        if (autoRes.ok && autoData.secure_url) {
          return autoData.secure_url;
        }
      } catch (_) { /* ignore auto fallback errors */ }
    }
    if (!res.ok) {
      const msg = data.error?.message || data.message || res.statusText || 'upload failed';
      throw new Error(msg);
    }
    if (!data.secure_url) throw new Error('Resposta Cloudinary sem URL');
    return data.secure_url;
  }

  // —— Texts ——
  const TEXT_KEYS = [
    { key: 'hero.title', label: 'Hero — título' },
    { key: 'hero.sub', label: 'Hero — subtítulo' },
    { key: 'intro.title', label: 'Sobre — título' },
    { key: 'intro.desc', label: 'Sobre — descrição' },
    { key: 'cta.title', label: 'CTA — título' },
    { key: 'cta.desc', label: 'CTA — texto' }
  ];

  function renderTexts() {
    const el = $('#textsForm');
    if (!el) return;
    const pt = texts.pt || {};
    el.innerHTML = TEXT_KEYS.map(t => `
      <div class="form-row">
        <label>${t.label}</label>
        <textarea data-text-key="${t.key}" rows="2">${pt[t.key] || ''}</textarea>
      </div>
    `).join('');
    el.querySelectorAll('[data-text-key]').forEach(ta => {
      ta.addEventListener('change', () => {
        if (!texts.pt) texts.pt = {};
        texts.pt[ta.dataset.textKey] = ta.value;
      });
    });
  }

  // —— Publish ——
  async function publish() {
    if (!(await adminConfirm(
      'Publicar no website?\n\nActualiza planos, textos e imagens para todos os visitantes.',
      { title: 'Publicar', confirmLabel: 'Publicar' }
    ))) return;
    $$('[data-text-key]').forEach(ta => {
      if (!texts.pt) texts.pt = {};
      texts.pt[ta.dataset.textKey] = ta.value;
    });
    // Drop empty slots so we don't publish "" over a good image
    const imagesClean = {};
    Object.keys(images || {}).forEach(k => {
      if (images[k]) imagesClean[k] = images[k];
    });
    images = imagesClean;
    const catalog = {
      updatedAt: new Date().toISOString(),
      products, zones: [], texts, images: imagesClean
    };
    try {
      toast('A publicar…');
      const res = await fetchWithTimeout(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getAdminPassword(), catalog })
      }, WORKER_FETCH_MS);
      if (!res.ok) throw new Error(await res.text());
      syncLocalFromState();
      toast('Publicado no website — visitantes verão após refresh');
    } catch (err) {
      toast(
        isTimeoutError(err)
          ? 'Publicar: servidor não respondeu (rede?). Tente de novo.'
          : 'Erro ao publicar: ' + (err.message || err)
      );
    }
  }

  /** Drop unpublished local catalog edits and reload what is live on the site. */
  async function discardLocalDraft() {
    const dirty = localStorage.getItem(LS.dirty) === '1';
    if (!dirty) {
      toast('Não há rascunho local neste browser');
      return;
    }
    if (!(await adminConfirm(
      'Descartar rascunho local?\n\nAs alterações de planos, imagens ou textos deste browser (ainda não publicadas) serão apagadas. O site continua como está.',
      { title: 'Descartar rascunho', confirmLabel: 'Descartar', danger: true }
    ))) return;
    try {
      localStorage.removeItem(LS.dirty);
      localStorage.removeItem(LS.products);
      localStorage.removeItem(LS.texts);
      localStorage.removeItem(LS.images);
    } catch (e) {}
    await loadState();
    renderAll();
    toast('Rascunho descartado — a mostrar o que está no site');
  }

  $('#publishBtn')?.addEventListener('click', publish);
  $('#discardDraftBtn')?.addEventListener('click', discardLocalDraft);

  function renderAll() {
    renderProducts();
    renderImageSlots();
    renderMediaLibrary();
    renderTexts();
    renderInbox();
    renderContacts();
    renderNewsletters();
    renderClients();
  }

  // —— Install admin PWA ——
  let deferredInstallPrompt = null;

  function isAdminAppInstalled() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.navigator.standalone === true) return true; // iOS Safari
    } catch (e) {}
    return false;
  }

  function isIosDevice() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function updateInstallButton() {
    const btn = $('#installAdminAppBtn');
    if (!btn) return;
    if (isAdminAppInstalled()) {
      btn.classList.add('is-installed');
      const label = btn.querySelector('.nav-label');
      if (label) label.textContent = 'App instalada';
      btn.title = 'Búzios Admin já está instalado neste dispositivo';
    } else {
      btn.classList.remove('is-installed');
      const label = btn.querySelector('.nav-label');
      if (label) label.textContent = 'Instalar app';
      btn.title = 'Instalar app no dispositivo';
    }
  }

  function openInstallHelp() {
    const modal = $('#installAppModal');
    const steps = $('#installAppSteps');
    const confirmBtn = $('#installAppConfirmBtn');
    const body = $('#installAppBody');
    if (!modal) return;

    if (isAdminAppInstalled()) {
      body.textContent = 'O painel já está a correr como aplicação neste dispositivo.';
      steps.innerHTML = '';
      if (confirmBtn) confirmBtn.style.display = 'none';
      modal.classList.add('open');
      return;
    }

    if (deferredInstallPrompt) {
      body.textContent = 'Instale o Búzios Admin no ecrã inicial para abrir mais rápido, como uma app.';
      steps.innerHTML = '<li>Toque em <strong>Instalar agora</strong> e confirme no diálogo do browser.</li>';
      if (confirmBtn) confirmBtn.style.display = 'block';
      modal.classList.add('open');
      return;
    }

    if (isIosDevice()) {
      body.textContent = 'No iPhone ou iPad, use o Safari:';
      steps.innerHTML = [
        '<li>Abra este painel no <strong>Safari</strong>.</li>',
        '<li>Toque no botão <strong>Partilhar</strong> (quadrado com seta).</li>',
        '<li>Escolha <strong>Adicionar ao Ecrã Principal</strong>.</li>',
        '<li>Confirme o nome <strong>Búzios Admin</strong> e toque em Adicionar.</li>'
      ].join('');
      if (confirmBtn) confirmBtn.style.display = 'none';
    } else {
      body.textContent = 'Para instalar no telemóvel ou computador:';
      steps.innerHTML = [
        '<li>No Chrome / Edge: menu (⋮) → <strong>Instalar aplicação</strong> ou <strong>Adicionar ao ecrã inicial</strong>.</li>',
        '<li>No Android Chrome: menu → <strong>Instalar app</strong> / <strong>Adicionar à página inicial</strong>.</li>',
        '<li>Se o browser ainda não mostrar a opção, use este site algumas vezes e tente de novo (é necessário HTTPS).</li>'
      ].join('');
      if (confirmBtn) confirmBtn.style.display = 'none';
    }
    modal.classList.add('open');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    toast('App instalada neste dispositivo');
    $('#installAppModal')?.classList.remove('open');
  });

  $('#installAdminAppBtn')?.addEventListener('click', () => {
    openInstallHelp();
  });
  $('#installAppConfirmBtn')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        toast('A instalar…');
      }
    } catch (e) {}
    deferredInstallPrompt = null;
    $('#installAppModal')?.classList.remove('open');
    updateInstallButton();
  });
  $('#closeInstallAppModal')?.addEventListener('click', () => $('#installAppModal')?.classList.remove('open'));
  $('#installAppDismissBtn')?.addEventListener('click', () => $('#installAppModal')?.classList.remove('open'));
  updateInstallButton();

  checkAuth();
})();
