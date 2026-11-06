/**
 * Búzios Admin — plans, images, texts, submissions, clients
 */
(function () {
  'use strict';

  const ADMIN_PASSWORD = 'buzios2026';
  const PUBLISH_URL = 'https://buzios-publish.gymngola.workers.dev/publish';
  const ADMIN_DATA_URL = 'https://buzios-publish.gymngola.workers.dev/admin/data';
  const CLOUD_NAME = 'ogtzpc3v';
  const UPLOAD_PRESET = 'buzios_unsigned';
  const CATALOG_FOLDER = 'buzios';
  // Worker proxy = always fresh (avoids Cloudinary CDN 30-day cache)
  const CATALOG_JSON_URL = 'https://buzios-publish.gymngola.workers.dev/catalog';
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
    if (authed) {
      if (localStorage.getItem(LS.auth) === '1' && $('#stayLoggedIn')) {
        $('#stayLoggedIn').checked = true;
      }
      showApp({ resume: true });
    }
  }
  async function showApp(opts) {
    const resume = !!(opts && opts.resume);
    document.documentElement.classList.add('admin-authed');
    $('#loginScreen').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    if (!resume) toast('A carregar catálogo…');
    await loadState();
    await loadStore();
    renderAll();
    startStoreSync();
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
    if ($('#adminPass').value === ADMIN_PASSWORD) {
      const stay = $('#stayLoggedIn') && $('#stayLoggedIn').checked;
      sessionStorage.setItem(LS.auth, '1');
      if (stay) {
        localStorage.setItem(LS.auth, '1');
      } else {
        localStorage.removeItem(LS.auth);
      }
      showApp();
    } else {
      $('#loginError').style.display = 'block';
    }
  });
  $('#adminPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginBtn').click();
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
    products: 'Planos',
    images: 'Imagens',
    texts: 'Textos',
    guide: 'Guia'
  };

  /** Panels that edit the public website catalog (need Publish). */
  const PUBLISH_PANELS = { products: true, images: true, texts: true };

  function activatePanel(name) {
    if (!name) return;
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
    // Live data panels: refresh when opened
    if (name === 'inbox' || name === 'contacts' || name === 'clients' || name === 'newsletters') {
      refreshStoreIfChanged();
    }
  }

  $$('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => activatePanel(btn.dataset.panel));
  });

  // Keep the same tab after reload (default stays Inscrições)
  try {
    const saved = sessionStorage.getItem('buzios_admin_panel');
    if (saved && $('#panel-' + saved)) activatePanel(saved);
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
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return data;
  }

  /** Multi-device + multi-tab sync. */
  let lastKnownUpdatedAt = null;
  let storeFetchInFlight = false;
  let localWriteInFlight = 0;
  let localWriteUntil = 0; // pause remote poll briefly after local write
  let storeSyncTimer = null;
  const STORE_SYNC_FOCUS_MS = 3500;
  const STORE_SYNC_HIDDEN_MS = 12000;
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

  async function loadStore(opts) {
    const silent = !!(opts && opts.silent);
    const workerOnly = !!(opts && opts.workerOnly);
    if (storeFetchInFlight) return false;
    storeFetchInFlight = true;
    if (!silent) setSyncStatus('syncing');
    try {
      let fromWorker = null;
      try {
        const res = await fetch(ADMIN_DATA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: ADMIN_PASSWORD, action: 'get' }),
          cache: 'no-store'
        });
        if (res.ok) {
          const data = await res.json();
          if (data.store) fromWorker = data.store;
        }
      } catch (e) {
        console.warn('Store load (worker) failed', e);
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

      if (!chosen) {
        if (!silent) setSyncStatus('error');
        return false;
      }

      if (silent && chosen.updatedAt && chosen.updatedAt === lastKnownUpdatedAt) {
        setSyncStatus('ok', 'Sincronizado');
        return false;
      }

      return applyStore(chosen, { silent: silent && !!lastKnownUpdatedAt });
    } finally {
      storeFetchInFlight = false;
    }
  }

  async function refreshStoreIfChanged() {
    if (document.hidden) return;
    if (storeFetchInFlight) return;
    if (Date.now() < localWriteUntil) return;
    await loadStore({ silent: true, workerOnly: true });
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
    // Create / open client
    if (s.fromClientId) {
      btns.push(`<button type="button" data-open-cli="${escapeHtml(s.fromClientId)}">Ver cliente</button>`);
    } else {
      btns.push(`<button type="button" data-promote-cli="${id}">Criar cliente</button>`);
      btns.push(`<button type="button" data-promote-cli-pend="${id}">Criar pendente (docs)</button>`);
    }
    if (status !== 'arquivado') {
      btns.push(`<button type="button" data-st="${id}" data-v="arquivado">Arquivar</button>`);
    }
    btns.push(`<button type="button" class="danger" data-del-sub="${id}">Apagar</button>`);
    return btns.join('');
  }

  function renderInbox() {
    const list = $('#inboxList');
    if (!list) return;
    let items = (store.submissions || []).filter(s => s.type === 'enrollment');
    if (inboxFilter && inboxFilter !== 'all') {
      items = items.filter(s => (s.status || 'novo') === inboxFilter);
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
      updateBulkBar('inbox');
      return;
    }
    list.innerHTML = items.map(s => {
      const status = s.status || 'novo';
      const statusLabel = SUB_STATUS_LABEL[status] || status;
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString('pt') : '';
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
          ${s.age ? '<div class="meta">Idade: ' + escapeHtml(String(s.age)) + '</div>' : ''}
          ${s.email ? '<div class="meta">Email: ' + escapeHtml(s.email) + '</div>' : ''}
          ${s.emergencyName || s.emergencyPhone
            ? '<div class="meta">Emergência: ' + escapeHtml([s.emergencyName, s.emergencyPhone].filter(Boolean).join(' — ')) + '</div>'
            : (s.emergency ? '<div class="meta">Emergência: ' + escapeHtml(s.emergency) + '</div>' : '')}
          ${s.goals ? '<div class="meta"><strong>Objectivos:</strong> ' + escapeHtml(s.goals) + '</div>' : ''}
          ${s.medicalConditions ? '<div class="meta"><strong>Condições médicas:</strong> ' + escapeHtml(s.medicalConditions) + '</div>' : ''}
          ${schedule}
          ${s.notes ? '<p style="font-size:0.85rem;margin:0.5rem 0;color:#444">' + escapeHtml(s.notes) + '</p>' : ''}
          ${s.docsLater ? '<div class="meta">Documentos: a entregar no local</div>' : ''}
          ${renderAttachmentGallery(s)}
          ${s.fromClientId ? '<div class="meta">Cliente ligado: <code>' + escapeHtml(s.fromClientId) + '</code></div>' : ''}
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
    list.querySelectorAll('[data-open-cli]').forEach(btn => {
      btn.addEventListener('click', () => {
        activatePanel('clients');
        openClientModal(btn.dataset.openCli);
      });
    });
    bindBulkItemChecks('inbox');
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
    btns.push(`<button type="button" class="danger" data-del-sub="${id}">Apagar</button>`);
    return btns.join('');
  }

  function renderContacts() {
    const list = $('#contactsList');
    if (!list) return;
    let items = (store.submissions || []).filter(s => s.type === 'contact' || (!s.type && s.message));
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
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString('pt') : '';
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
    id: 'BI / Cédula',
    medicalCert: 'Atestado',
    photo1: 'Foto 1',
    photo2: 'Foto 2',
    paymentProof: 'Pagamento',
    doc: 'Documento'
  };

  function shortDocLabel(a) {
    if (!a) return 'Doc';
    if (a.key && DOC_KEY_LABELS[a.key]) return DOC_KEY_LABELS[a.key];
    const lab = String(a.label || '').trim();
    if (/bi|c[eé]dula|passaporte/i.test(lab)) return 'BI / Cédula';
    if (/atestado|m[eé]dic/i.test(lab)) return 'Atestado';
    if (/foto.*1|passe\s*1/i.test(lab)) return 'Foto 1';
    if (/foto.*2|passe\s*2/i.test(lab)) return 'Foto 2';
    if (/comprova|pagament|recibo/i.test(lab)) return 'Pagamento';
    if (/foto|photo|passe/i.test(lab)) return 'Foto';
    return lab ? (lab.length > 18 ? lab.slice(0, 16) + '…' : lab) : 'Documento';
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

  /** Compact gallery for client modal (small thumbs + links). */
  function renderClientDocsBlock(c) {
    const items = clientAttachments(c);
    if (!items.length) {
      return '<div id="cDocsBlock" class="client-docs-block" style="display:none"></div>';
    }
    const chips = items.map(a => {
      const href = escapeHtml(fixAttachmentUrl(a.url));
      const label = escapeHtml(shortDocLabel(a));
      const full = escapeHtml(a.label || a.name || label);
      const img = isImageUrl(a.url);
      if (img) {
        return `<a class="client-doc-thumb" href="${href}" target="_blank" rel="noopener" title="${full}">
          <img src="${href}" alt="${label}" loading="lazy">
          <span>${label}</span>
        </a>`;
      }
      return `<a class="client-doc-file" href="${href}" target="_blank" rel="noopener" title="${full}">📄 ${label}</a>`;
    }).join('');
    return `<div id="cDocsBlock" class="client-docs-block">
      <div class="meta" style="margin-bottom:0.4rem"><strong>Documentos da inscrição (${items.length})</strong></div>
      <div class="client-docs-grid">${chips}</div>
    </div>`;
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
        if (!confirm('Apagar esta entrada?')) return;
        btn.disabled = true;
        const ok = await adminAction('delete_submission', { id });
        if (ok) toast('Apagado');
        else {
          btn.disabled = false;
          toast('Não foi possível apagar');
        }
      });
    });
  }

  async function adminAction(action, data, opts) {
    const silent = opts && opts.silent;
    localWriteInFlight++;
    localWriteUntil = Date.now() + LOCAL_WRITE_COOLDOWN_MS;
    try {
      const res = await fetch(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, action, data }),
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          // Own write: apply without "outro dispositivo" toast, then notify other tabs
          const prevAt = lastKnownUpdatedAt;
          store = json.store;
          if (json.store.updatedAt) lastKnownUpdatedAt = json.store.updatedAt;
          renderInbox();
          renderContacts();
          renderNewsletters();
          renderClients();
          broadcastStore(json.store);
          setSyncStatus('ok', 'Sincronizado');
          // Keep prevAt reference to avoid unused lint; own writes never toast remote
          void prevAt;
        } else if (!silent) {
          renderInbox();
          renderContacts();
          renderNewsletters();
          renderClients();
        }
        return true;
      } else {
        if (!silent) toast('Erro ao actualizar');
        setSyncStatus('error', 'Erro ao gravar');
        return false;
      }
    } catch (e) {
      if (!silent) toast('Erro de rede');
      setSyncStatus('error', 'Erro de rede');
      return false;
    } finally {
      localWriteInFlight = Math.max(0, localWriteInFlight - 1);
    }
  }

  // —— Bulk selection ——
  function getSelectedIds(listName) {
    return $$('.bulk-item[data-list="' + listName + '"]:checked').map(el => el.dataset.id).filter(Boolean);
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
      all.checked = items.length > 0 && selected.length === items.length;
      all.indeterminate = selected.length > 0 && selected.length < items.length;
    }
    // Floating action bar for clients when something is selected
    if (listName === 'clients') {
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
    $$('.bulk-item[data-list="' + listName + '"]').forEach(cb => {
      cb.addEventListener('change', () => updateBulkBar(listName));
    });
  }

  async function runBulkAction(listName, action) {
    const ids = getSelectedIds(listName);
    if (!ids.length) return toast('Seleccione pelo menos um item');

    // Clients: bulk WhatsApp / export selected
    if (listName === 'clients' && action === 'whatsapp') {
      const clients = (store.clients || []).filter(c => ids.includes(c.id));
      const phones = clients.map(c => c.phone).filter(Boolean);
      if (!phones.length) return toast('Nenhum telefone nos seleccionados');
      // Open first WhatsApp; copy all numbers for the rest
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
      const items = getVisibleClients().filter(c => ids.includes(c.id));
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

    if (action === 'delete') {
      if (!confirm('Apagar ' + ids.length + ' item(ns) seleccionados? Esta acção não pode ser desfeita.')) return;
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
          success = await adminAction('delete_client', { id, hard: true }, { silent: true });
        } else if (action === 'archive') {
          success = await adminAction('delete_client', { id, hard: false }, { silent: true });
        } else if (action === 'suspend') {
          const existing = (store.clients || []).find(c => c.id === id);
          if (existing) {
            success = await adminAction('update_client', enrichClient(Object.assign({}, existing, { membershipStatus: 'suspenso' })), { silent: true });
          }
        }
      }
      if (success) ok++;
    }
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
      $$('.bulk-item[data-list="' + listName + '"]').forEach(cb => {
        cb.checked = all.checked;
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
  function renderNewsletters() {
    const list = $('#newslettersList');
    if (!list) return;
    const items = store.newsletters || [];
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhum número ainda. Aparecem quando alguém preenche o formulário no rodapé do site.</p>';
      updateBulkBar('newsletters');
      return;
    }
    list.innerHTML = items.map(n => {
      const when = n.createdAt ? new Date(n.createdAt).toLocaleString('pt') : '';
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
        if (!confirm('Apagar este número da newsletter?')) return;
        await adminAction('delete_newsletter', { id: btn.dataset.delNl });
        toast('Número apagado');
      });
    });
    bindBulkItemChecks('newsletters');
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

  const CYCLE_MONTHS = { mensal: 1, trimestral: 3, anual: 12, pacote: 1 };

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const end = new Date(dateStr + 'T23:59:59');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((end - today) / 86400000);
  }

  function addMonthsISO(isoDate, months) {
    const base = isoDate ? new Date(isoDate + 'T12:00:00') : new Date();
    base.setMonth(base.getMonth() + months);
    return base.toISOString().slice(0, 10);
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
    if (out.billingStatus === 'isento') {
      if (out._expired) out.membershipStatus = out.membershipStatus || 'activo';
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
      if (out.billingStatus !== 'isento') out.billingStatus = 'em_divida';
      return out;
    }
    if (out._expired) {
      out.membershipStatus = 'expirado';
      if (out.billingStatus !== 'isento') out.billingStatus = 'em_divida';
    }
    // Do NOT force expirado → activo when planEnd is still valid; respect explicit choice.
    if (out.billingStatus === 'atrasado') out.billingStatus = 'em_divida';
    return out;
  }

  function clientMatchesFilter(c, filter) {
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

  function clientMatchesSearch(c, q) {
    if (!q) return true;
    const hay = [
      c.name, c.phone, c.email, c.planName, c.notes,
      c.emergencyName, c.emergencyPhone, c.memberNumber, c.schedule, c.age, c.hasCard
    ]
      .map(x => String(x || '').toLowerCase())
      .join(' ');
    const digits = normalizePhone(q);
    if (digits && normalizePhone(c.phone).includes(digits)) return true;
    if (/^\d+$/.test(q.trim()) && String(c.memberNumber || '') === q.trim()) return true;
    return hay.includes(q.toLowerCase());
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
    let activo = 0, aExpirar = 0, expirado = 0, divida = 0, pendente = 0;
    items.forEach(c => {
      if (c.membershipStatus === 'arquivado') return;
      if (c.membershipStatus === 'pendente') pendente++;
      if (c.membershipStatus === 'activo' && !c._expired) activo++;
      if (c._expiringSoon && c.membershipStatus === 'activo') aExpirar++;
      if (c.membershipStatus === 'expirado' || c._expired) expirado++;
      if (c.billingStatus === 'em_divida' || c.billingStatus === 'atrasado') divida++;
    });
    return { activo, aExpirar, expirado, divida, pendente, total: items.length };
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
      if (c.membershipStatus === 'arquivado') return false;
      return normalizePhone(c.phone) === n;
    }) || null;
  }

  function getVisibleClients() {
    const raw = store.clients || [];
    let items = raw.map(enrichClient);
    items = items.filter(c => clientMatchesFilter(c, clientsFilter));
    items = items.filter(c => clientMatchesSearch(c, clientsSearch));
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
      list.innerHTML = '<div class="clients-empty">Nenhum cliente ainda. Surgem automaticamente das inscrições ou adicione com <strong>+ Cliente</strong>.</div>';
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
        const search = $('#clientSearch');
        if (search) search.value = '';
        $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === 'all');
        });
        renderClients();
      });
      updateBulkBar('clients');
      return;
    }

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

      const primaryActions = `
        <button type="button" class="btn-renew" data-renew-cli="${c.id}">Renovar</button>
        ${wa ? '<a class="wa-btn" href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' : ''}
      `;
      const secondaryButtons = `
        <button type="button" data-edit-cli="${c.id}">Editar</button>
        ${mem !== 'suspenso' && mem !== 'arquivado' ? '<button type="button" data-status-cli="' + c.id + '" data-status-v="suspenso">Suspender</button>' : ''}
        ${mem === 'suspenso' || mem === 'arquivado' ? '<button type="button" data-status-cli="' + c.id + '" data-status-v="activo">Reactivar</button>' : ''}
        ${mem !== 'arquivado' ? '<button type="button" data-archive-cli="' + c.id + '">Arquivar</button>' : ''}
        <button type="button" class="danger" data-del-cli="${c.id}">Apagar</button>
      `;

      return `
        <div class="${rowClass}">
          <div class="row-check">
            <input type="checkbox" class="bulk-item" data-list="clients" data-id="${escapeHtml(c.id)}" aria-label="Seleccionar ${escapeHtml(c.name || '')}">
          </div>
          <div class="row-main">
            <span class="row-name" data-edit-cli="${c.id}" title="Editar">${c.memberNumber != null ? '<span class="member-n">Nº ' + escapeHtml(String(c.memberNumber)) + '</span> ' : ''}${escapeHtml(c.name || '—')}</span>
            <span class="row-badges">
              <span class="status-badge status-${mem}">${mem}</span>
              <span class="status-badge status-${bill}">${bill.replace('_', ' ')}</span>
              ${isExpiring ? '<span class="status-badge status-a_expirar">a expirar</span>' : ''}
              ${c.hasCard === 'sim' ? '<span class="status-badge status-card">cartão</span>' : ''}
            </span>
            <div class="row-contact">${[contactBits, c.schedule ? 'Horário ' + escapeHtml(c.schedule) : '', c.age != null ? 'Idade ' + escapeHtml(String(c.age)) : ''].filter(Boolean).join(' · ') || '—'}</div>
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
            ${needsAttention ? primaryActions : ''}
            ${!needsAttention ? `
              <button type="button" data-edit-cli="${c.id}" class="hide-mobile">Editar</button>
              <button type="button" class="btn-renew" data-renew-cli="${c.id}">Renovar</button>
              ${wa ? '<a class="wa-btn" href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' : ''}
            ` : `
              <button type="button" data-edit-cli="${c.id}" class="hide-mobile">Editar</button>
            `}
            <details class="row-more">
              <summary>Mais</summary>
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
        if (!confirm('Arquivar ' + (existing.name || 'este cliente') + '? Pode reactivar depois no filtro Arquivados.')) return;
        const ok = await adminAction('delete_client', { id: existing.id, hard: false });
        if (ok) toast('Cliente arquivado');
      });
    });
    list.querySelectorAll('[data-del-cli]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existing = (store.clients || []).find(x => String(x.id) === String(btn.dataset.delCli));
        if (!existing) return;
        if (!confirm('APAGAR definitivamente ' + (existing.name || 'este cliente') + '?\n\nPrefira Arquivar se quiser manter histórico.')) return;
        if (!confirm('Confirma apagar para sempre?')) return;
        const ok = await adminAction('delete_client', { id: existing.id, hard: true });
        if (ok) toast('Cliente apagado');
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
    updateBulkBar('clients');
  }

  function renderPayHistory(payments) {
    const el = $('#cPayHistory');
    if (!el) return;
    const list = payments || [];
    if (!list.length) {
      el.innerHTML = '<li style="color:#999">Ainda sem pagamentos registados.</li>';
      return;
    }
    el.innerHTML = list.slice(0, 20).map(p => {
      const when = p.paidAt ? new Date(p.paidAt).toLocaleString('pt') : '';
      const amt = p.amount != null ? Number(p.amount).toLocaleString('pt') + ' Kz' : '';
      const method = p.method || '';
      const note = p.note ? ' — ' + escapeHtml(p.note) : '';
      return `<li><strong>${amt}</strong> · ${escapeHtml(method)} · ${when}${note}</li>`;
    }).join('');
  }

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
    const out = { memberNumber: null, schedule: '', hasCard: '', age: null, cleanedNotes: notes || '' };
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

    // Strip structured segments so notes stay free-text only
    rest = rest
      .replace(/(?:^|[·|]\s*)N[ºo°.]?\s*\d+/gi, '')
      .replace(/(?:^|[·|]\s*)Hor[aá]rio\s+[0-2]?\d:[0-5]\d/gi, '')
      .replace(/(?:^|[·|]\s*)Cart[aã]o:\s*[^\s·|]+/gi, '')
      .replace(/(?:^|[·|]\s*)Idade\s+\d{1,3}/gi, '')
      .replace(/^[·|\s]+|[·|\s]+$/g, '')
      .replace(/\s*[·|]\s*[·|]\s*/g, ' · ')
      .replace(/\s{2,}/g, ' ')
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

  function openClientModal(id) {
    editingClientId = id || null;
    const c = id ? (store.clients || []).find(x => x.id === id) : null;
    const title = $('#clientModalTitle');
    if (title) title.textContent = c ? 'Editar cliente' : 'Novo cliente';
    $('#cName').value = c?.name || '';
    $('#cPhone').value = c?.phone || '';
    $('#cEmail').value = c?.email || '';
    $('#cArea').value = c?.area || 'ginasio';

    // Structured fields — prefer real keys; fallback-parse legacy notes once
    const meta = parseClientNotesMeta(c?.notes);
    const memberNum = c?.memberNumber != null ? c.memberNumber : meta.memberNumber;
    const age = c?.age != null ? c.age : meta.age;
    let schedule = c?.schedule || meta.schedule || '';
    let hasCard = c?.hasCard || meta.hasCard || '';
    if (hasCard === true || hasCard === 'SIM' || hasCard === 'Sim') hasCard = 'sim';
    if (hasCard === false || hasCard === 'N' || hasCard === 'SEM' || hasCard === 'Não' || hasCard === 'Nao') hasCard = 'nao';

    $('#cMemberNumber').value = memberNum != null && memberNum !== '' ? memberNum : '';
    $('#cAge').value = age != null && age !== '' ? age : '';
    setScheduleSelect(schedule);
    $('#cHasCard').value = hasCard === 'sim' || hasCard === 'nao' ? hasCard : '';

    // If structured keys were missing and we parsed them, show cleaned notes
    const usedNotesFallback = c && (
      (c.memberNumber == null && meta.memberNumber != null) ||
      (c.age == null && meta.age != null) ||
      (!c.schedule && meta.schedule) ||
      (!c.hasCard && meta.hasCard)
    );
    $('#cNotes').value = usedNotesFallback ? meta.cleanedNotes : (c?.notes || '');

    $('#cPlan').value = c?.planName || c?.planId || '';
    $('#cPrice').value = c?.price != null ? c.price : '';
    $('#cCycle').value = c?.billingCycle || 'mensal';
    $('#cPlanStart').value = c?.planStart || '';
    $('#cPlanEnd').value = c?.planEnd || '';
    $('#cMembership').value = c?.membershipStatus || 'pendente';
    $('#cBilling').value = (c?.billingStatus === 'atrasado' ? 'em_divida' : (c?.billingStatus || 'em_dia'));
    $('#cEmergencyName').value = c?.emergencyName || '';
    $('#cEmergencyPhone').value = c?.emergencyPhone || '';
    $('#cPayAmount').value = c?.price != null ? c.price : '';
    $('#cPayMethod').value = 'cash';
    $('#cPayNote').value = '';
    renderPayHistory(c?.payments);
    const payBlock = $('#paymentBlock');
    if (payBlock) payBlock.style.display = id ? '' : 'none';
    const archBtn = $('#archiveClientBtn');
    const delBtn = $('#deleteClientBtn');
    if (archBtn) archBtn.style.display = id ? '' : 'none';
    if (delBtn) delBtn.style.display = id ? '' : 'none';
    const subLink = $('#cSubLink');
    if (subLink) {
      if (c && c.fromSubmission) {
        subLink.style.display = '';
        subLink.innerHTML = 'Ligado à inscrição <code>' + escapeHtml(c.fromSubmission) + '</code>';
      } else {
        subLink.style.display = 'none';
        subLink.innerHTML = '';
      }
    }
    // Documents from client record or linked enrollment
    let docsHost = $('#cDocsHost');
    if (!docsHost) {
      docsHost = document.createElement('div');
      docsHost.id = 'cDocsHost';
      const notesRow = $('#cNotes') && $('#cNotes').closest('.form-row');
      if (notesRow && notesRow.parentNode) {
        notesRow.parentNode.insertBefore(docsHost, notesRow.nextSibling);
      } else {
        const pay = $('#paymentBlock');
        if (pay && pay.parentNode) pay.parentNode.insertBefore(docsHost, pay);
      }
    }
    docsHost.innerHTML = renderClientDocsBlock(c);
    updateDupWarn(c?.phone || '', id);
    $('#clientModal').classList.add('open');
  }

  function readClientForm(existing) {
    const priceVal = $('#cPrice').value;
    const memberRaw = $('#cMemberNumber') && $('#cMemberNumber').value;
    const ageRaw = $('#cAge') && $('#cAge').value;
    const scheduleVal = ($('#cSchedule') && $('#cSchedule').value) || '';
    const hasCardVal = ($('#cHasCard') && $('#cHasCard').value) || '';
    const data = {
      id: editingClientId || ('cli-' + Date.now()),
      name: $('#cName').value.trim(),
      phone: $('#cPhone').value.trim(),
      email: $('#cEmail').value.trim(),
      area: $('#cArea').value,
      memberNumber: memberRaw === '' || memberRaw == null ? null : Number(memberRaw),
      age: ageRaw === '' || ageRaw == null ? null : Number(ageRaw),
      schedule: scheduleVal || '',
      hasCard: hasCardVal || '',
      planName: $('#cPlan').value.trim(),
      planId: existing?.planId || '',
      price: priceVal === '' ? null : Number(priceVal),
      billingCycle: $('#cCycle').value,
      planStart: $('#cPlanStart').value || null,
      planEnd: $('#cPlanEnd').value || null,
      membershipStatus: $('#cMembership').value,
      billingStatus: $('#cBilling').value,
      emergencyName: ($('#cEmergencyName') && $('#cEmergencyName').value.trim()) || '',
      emergencyPhone: ($('#cEmergencyPhone') && $('#cEmergencyPhone').value.trim()) || '',
      notes: $('#cNotes').value.trim(),
      payments: existing?.payments || [],
      lastPaymentAt: existing?.lastPaymentAt || null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      fromSubmission: existing?.fromSubmission || null,
      fromImport: existing?.fromImport || null,
      archivedAt: existing?.archivedAt || null,
      // Keep enrollment documents when editing
      attachments: existing?.attachments || null,
      documents: existing?.documents || null,
      paymentProof: existing?.paymentProof || null
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
    if (!confirm('Renovar ' + (existing.name || 'cliente') + ' até ' + formatDatePT(end) + (amount ? ' (' + amount.toLocaleString('pt') + ' Kz)?' : '?'))) {
      return;
    }
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
    // Copy enrollment documents onto the client so they appear on Clientes
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

    const data = enrichClient({
      id: base.id || ('cli-' + Date.now()),
      name: s.name || base.name || '',
      phone: phone || base.phone || '',
      email: s.email || base.email || '',
      area: s.area || base.area || 'ginasio',
      memberNumber: base.memberNumber != null ? base.memberNumber : null,
      age: s.age != null ? Number(s.age) : (base.age != null ? base.age : null),
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
      planStart: base.planStart || todayISO(),
      planEnd: base.planEnd || addMonthsISO(todayISO(), 1),
      // Pending until all documents are provided; otherwise active
      membershipStatus: asPending ? 'pendente' : 'activo',
      billingStatus: asPending ? (base.billingStatus || 'em_dia') : (base.billingStatus || 'em_dia'),
      emergencyName: s.emergencyName || base.emergencyName || '',
      emergencyPhone: s.emergencyPhone || base.emergencyPhone || '',
      notes: [
        base.notes,
        s.goals ? 'Objectivos: ' + s.goals : '',
        s.medicalConditions ? 'Condições médicas: ' + s.medicalConditions : '',
        s.notes,
        pendingNote
      ].filter(Boolean).join('\n').trim(),
      payments: base.payments || [],
      lastPaymentAt: base.lastPaymentAt || null,
      createdAt: base.createdAt || new Date().toISOString(),
      fromSubmission: s.id,
      attachments: mergedAttachments.length ? mergedAttachments : (base.attachments || null),
      documents: base.documents || null,
      paymentProof: s.paymentProof || base.paymentProof || null
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
  $('#backupAllBtn')?.addEventListener('click', downloadFullBackup);
  $('#exportClientsBtn')?.addEventListener('click', exportClientsCsv);
  $('#copyClientPhonesBtn')?.addEventListener('click', copyClientPhones);

  $('#clientSearch')?.addEventListener('input', (e) => {
    clientsSearch = e.target.value.trim();
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

  $('#saveClientBtn')?.addEventListener('click', async () => {
    const existing = editingClientId
      ? (store.clients || []).find(x => x.id === editingClientId)
      : null;
    const data = readClientForm(existing);
    if (!data.name) return toast('Nome obrigatório');
    const dup = findDuplicatePhone(data.phone, data.id);
    if (dup && !confirm('Já existe cliente com este telefone (' + (dup.name || dup.phone) + '). Guardar na mesma?')) {
      return;
    }
    const btn = $('#saveClientBtn');
    if (btn) btn.disabled = true;
    const ok = await adminAction('update_client', data);
    if (btn) btn.disabled = false;
    if (ok) {
      $('#clientModal').classList.remove('open');
      toast('Cliente guardado');
    }
    // On failure adminAction already toasts "Erro ao actualizar"
  });

  $('#archiveClientBtn')?.addEventListener('click', async () => {
    if (!editingClientId) return;
    const existing = (store.clients || []).find(x => String(x.id) === String(editingClientId));
    if (!existing) return;
    if (!confirm('Arquivar ' + (existing.name || 'este cliente') + '?')) return;
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
    if (!confirm('APAGAR definitivamente ' + (existing.name || 'este cliente') + '?\n\nIsto não pode ser desfeito. Prefira Arquivar se quiser manter histórico.')) return;
    if (!confirm('Confirma apagar para sempre?')) return;
    const ok = await adminAction('delete_client', { id: editingClientId, hard: true });
    if (ok) {
      $('#clientModal').classList.remove('open');
      toast('Cliente apagado');
    }
  });

  $('#payRenewBtn')?.addEventListener('click', async () => {
    if (!editingClientId) return toast('Guarde o cliente primeiro');
    const existing = (store.clients || []).find(x => x.id === editingClientId);
    if (!existing) return;
    const amountStr = $('#cPayAmount').value;
    const amount = amountStr === '' ? (existing.price != null ? Number(existing.price) : 0) : Number(amountStr);
    const cycle = $('#cCycle').value || existing.billingCycle || 'mensal';
    const months = CYCLE_MONTHS[cycle] || 1;
    const currentEnd = $('#cPlanEnd').value || existing.planEnd;
    const start = currentEnd && daysUntil(currentEnd) >= 0 ? currentEnd : todayISO();
    const end = addMonthsISO(start, months);
    const payment = {
      id: 'pay-' + Date.now(),
      amount: amount,
      paidAt: new Date().toISOString(),
      method: $('#cPayMethod').value,
      note: $('#cPayNote').value.trim(),
      periodStart: start,
      periodEnd: end
    };
    const payments = (existing.payments || []).slice();
    payments.unshift(payment);
    // Sync form dates before save
    $('#cPlanStart').value = $('#cPlanStart').value || start;
    $('#cPlanEnd').value = end;
    $('#cMembership').value = 'activo';
    $('#cBilling').value = 'em_dia';
    if (amount && !$('#cPrice').value) $('#cPrice').value = amount;
    const data = readClientForm(Object.assign({}, existing, { payments: payments.slice(0, 50), lastPaymentAt: payment.paidAt }));
    data.planStart = data.planStart || start;
    data.planEnd = end;
    data.membershipStatus = 'activo';
    data.billingStatus = 'em_dia';
    data.lastPaymentAt = payment.paidAt;
    data.payments = payments.slice(0, 50);
    data.billingCycle = cycle;
    if (amount) data.price = amount;
    await adminAction('update_client', data);
    toast('Pagamento registado · válido até ' + formatDatePT(end));
    openClientModal(editingClientId);
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
      btn.addEventListener('click', () => {
        if (confirm('Apagar este plano?')) {
          products = products.filter(x => x.id !== btn.dataset.del);
          markDirty();
          renderProducts();
        }
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
    async function post(withFolder) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', UPLOAD_PRESET);
      if (withFolder) fd.append('folder', CATALOG_FOLDER);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST', body: fd
      });
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
    if (!confirm('Publicar no website?\n\nActualiza planos, textos e imagens para todos os visitantes.')) return;
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
      const res = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, catalog })
      });
      if (!res.ok) throw new Error(await res.text());
      syncLocalFromState();
      toast('Publicado no website — visitantes verão após refresh');
    } catch (err) {
      toast('Erro ao publicar: ' + (err.message || err));
    }
  }

  /** Drop unpublished local catalog edits and reload what is live on the site. */
  async function discardLocalDraft() {
    const dirty = localStorage.getItem(LS.dirty) === '1';
    if (!dirty) {
      toast('Não há rascunho local neste browser');
      return;
    }
    if (!confirm('Descartar rascunho local?\n\nAs alterações de planos, imagens ou textos deste browser (ainda não publicadas) serão apagadas. O site continua como está.')) return;
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
