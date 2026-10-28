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
    if (sessionStorage.getItem(LS.auth) === '1' || localStorage.getItem(LS.auth) === '1') {
      showApp();
    }
  }
  async function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    toast('A carregar catálogo…');
    await loadState();
    loadStore();
    renderAll();
  }
  $('#loginBtn').addEventListener('click', () => {
    if ($('#adminPass').value === ADMIN_PASSWORD) {
      sessionStorage.setItem(LS.auth, '1');
      showApp();
    } else {
      $('#loginError').style.display = 'block';
    }
  });
  $('#adminPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginBtn').click();
  });

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
    try {
      sessionStorage.setItem('buzios_admin_panel', name);
    } catch (e) {}
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
        toast('Rascunho local (ainda não publicado)');
      }
    } else {
      // Clean browser → match live catalog
      localStorage.setItem(LS.products, JSON.stringify(products));
      localStorage.setItem(LS.texts, JSON.stringify(texts));
      localStorage.setItem(LS.images, JSON.stringify(images));
    }
  }

  async function loadStore() {
    try {
      const res = await fetch(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, action: 'get' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.store) store = data.store;
      }
    } catch (e) {
      console.warn('Store load failed', e);
    }
    renderInbox();
    renderContacts();
    renderNewsletters();
    renderClients();
  }

  function markDirty() {
    localStorage.setItem(LS.dirty, '1');
  }

  function saveDraft() {
    localStorage.setItem(LS.products, JSON.stringify(products));
    localStorage.setItem(LS.texts, JSON.stringify(texts));
    localStorage.setItem(LS.images, JSON.stringify(images));
    localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
    markDirty();
    toast('Rascunho guardado neste browser (só este)');
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
  function renderInbox() {
    const list = $('#inboxList');
    if (!list) return;
    const items = (store.submissions || []).filter(s => s.type === 'enrollment');
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhuma inscrição ainda. Aparecem quando alguém preenche o formulário de inscrição.</p>';
      return;
    }
    list.innerHTML = items.map(s => {
      const status = s.status || 'novo';
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString('pt') : '';
      const schedule = Array.isArray(s.schedule) && s.schedule.length
        ? '<div class="meta">Horário: ' + s.schedule.join(', ') + '</div>'
        : '';
      return `
        <div class="prod-card">
          <h3>${escapeHtml(s.name || '—')} <span class="status-badge status-${status}">${status}</span></h3>
          <div class="meta">Inscrição · ${escapeHtml(s.phone || '')} · ${when}</div>
          <div class="meta" style="margin-top:0.35rem">
            ${s.area ? 'Área: ' + escapeHtml(s.area) + ' · ' : ''}
            ${escapeHtml(s.planName || s.planId || '')}
          </div>
          ${s.planIdGym || s.planIdSwim ? '<div class="meta">Ginásio: ' + escapeHtml(s.planIdGym || '—') + ' · Natação: ' + escapeHtml(s.planIdSwim || '—') + '</div>' : ''}
          ${s.annualFee ? '<div class="meta">Inscrição anual: sim</div>' : ''}
          ${s.extras && s.extras.length ? '<div class="meta">Extras: ' + escapeHtml(s.extras.join(', ')) + '</div>' : ''}
          ${s.estimatedTotal != null ? '<div class="meta">Total estimado: ' + Number(s.estimatedTotal).toLocaleString('pt') + ' Kz</div>' : ''}
          ${s.age ? '<div class="meta">Idade: ' + escapeHtml(String(s.age)) + '</div>' : ''}
          ${s.emergencyName || s.emergencyPhone
            ? '<div class="meta">Emergência: ' + escapeHtml([s.emergencyName, s.emergencyPhone].filter(Boolean).join(' — ')) + '</div>'
            : (s.emergency ? '<div class="meta">Emergência: ' + escapeHtml(s.emergency) + '</div>' : '')}
          ${schedule}
          ${s.notes ? '<p style="font-size:0.85rem;margin:0.5rem 0;color:#444">' + escapeHtml(s.notes) + '</p>' : ''}
          ${s.attachments && s.attachments.length ? '<div class="meta">Anexos (' + s.attachments.length + '): ' + s.attachments.map((u,i) => '<a href="'+escapeHtml(fixAttachmentUrl(u))+'" target="_blank" rel="noopener">doc'+(i+1)+'</a>').join(', ') + '</div>' : ''}
          <div class="actions" style="margin-top:0.65rem">
            <button type="button" data-st="${s.id}" data-v="contactado">Contactado</button>
            <button type="button" data-st="${s.id}" data-v="inscrito">Inscrito</button>
            <button type="button" data-st="${s.id}" data-v="arquivado">Arquivar</button>
            <button type="button" class="danger" data-del-sub="${s.id}">Apagar</button>
          </div>
        </div>`;
    }).join('');

    bindSubmissionActions(list);
  }

  // —— Contact form messages ——
  function renderContacts() {
    const list = $('#contactsList');
    if (!list) return;
    const items = (store.submissions || []).filter(s => s.type === 'contact' || (!s.type && s.message));
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhuma mensagem de contacto ainda. Aparecem quando alguém envia o formulário na página Contacto.</p>';
      return;
    }
    list.innerHTML = items.map(s => {
      const status = s.status || 'novo';
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString('pt') : '';
      const msg = s.message || s.notes || '';
      return `
        <div class="prod-card">
          <h3>${escapeHtml(s.name || '—')} <span class="status-badge status-${status}">${status}</span></h3>
          <div class="meta">Contacto · ${escapeHtml(s.phone || '')} · ${when}</div>
          <div class="meta" style="margin-top:0.35rem">
            ${s.subject ? 'Assunto: ' + escapeHtml(s.subject) : ''}
            ${s.preferContact ? ' · Preferência: ' + escapeHtml(s.preferContact) : ''}
            ${s.email ? ' · ' + escapeHtml(s.email) : ''}
          </div>
          ${msg ? '<p style="font-size:0.85rem;margin:0.5rem 0;color:#444;white-space:pre-wrap">' + escapeHtml(msg) + '</p>' : ''}
          <div class="actions" style="margin-top:0.65rem">
            <button type="button" data-st="${s.id}" data-v="contactado">Respondido</button>
            <button type="button" data-st="${s.id}" data-v="arquivado">Arquivar</button>
            <button type="button" class="danger" data-del-sub="${s.id}">Apagar</button>
          </div>
        </div>`;
    }).join('');

    bindSubmissionActions(list);
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
    if (!url || typeof url !== 'string') return url || '';
    if (/\.pdf($|\?)/i.test(url) && url.includes('/image/upload/')) {
      return url.replace('/image/upload/', '/raw/upload/');
    }
    return url;
  }

  function bindSubmissionActions(list) {
    list.querySelectorAll('[data-st]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await adminAction('update_submission', { id: btn.dataset.st, status: btn.dataset.v });
        toast('Estado actualizado');
      });
    });
    list.querySelectorAll('[data-del-sub]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Apagar esta entrada?')) return;
        await adminAction('delete_submission', { id: btn.dataset.delSub });
        toast('Apagado');
      });
    });
  }

  async function adminAction(action, data) {
    try {
      const res = await fetch(ADMIN_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, action, data })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) store = json.store;
        renderInbox();
        renderContacts();
        renderNewsletters();
        renderClients();
      } else {
        toast('Erro ao actualizar');
      }
    } catch (e) {
      toast('Erro de rede');
    }
  }

  // —— Newsletter phones ——
  function renderNewsletters() {
    const list = $('#newslettersList');
    if (!list) return;
    const items = store.newsletters || [];
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhum número ainda. Aparecem quando alguém preenche o formulário no rodapé do site.</p>';
      return;
    }
    list.innerHTML = items.map(n => {
      const when = n.createdAt ? new Date(n.createdAt).toLocaleString('pt') : '';
      const phone = n.phone || '—';
      const wa = String(phone).replace(/\D/g, '');
      const waLink = wa ? `https://wa.me/${wa.startsWith('244') ? wa : '244' + wa}` : '#';
      return `
        <div class="prod-card">
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

  /** Derive membership/billing from planEnd (respect suspenso/cancelado/isento). */
  function enrichClient(c) {
    const out = Object.assign({}, c);
    const days = daysUntil(out.planEnd);
    out._daysLeft = days;
    out._expiringSoon = days !== null && days >= 0 && days <= 7;
    out._expired = days !== null && days < 0;

    if (out.membershipStatus === 'suspenso' || out.membershipStatus === 'cancelado') {
      return out;
    }
    if (out.billingStatus === 'isento') {
      if (out._expired) out.membershipStatus = out.membershipStatus || 'activo';
      return out;
    }
    if (out._expired) {
      out.membershipStatus = 'expirado';
      if (out.billingStatus !== 'isento') out.billingStatus = 'em_divida';
    } else if (out.membershipStatus === 'expirado' && days !== null && days >= 0) {
      out.membershipStatus = 'activo';
    }
    if (out.billingStatus === 'atrasado') out.billingStatus = 'em_divida';
    return out;
  }

  function clientMatchesFilter(c, filter) {
    if (filter === 'all') return true;
    if (filter === 'activo') return c.membershipStatus === 'activo' && !c._expired;
    if (filter === 'a_expirar') return c._expiringSoon && c.membershipStatus === 'activo';
    if (filter === 'expirado') return c.membershipStatus === 'expirado' || c._expired;
    if (filter === 'em_divida') return c.billingStatus === 'em_divida' || c.billingStatus === 'atrasado';
    if (filter === 'pendente') return c.membershipStatus === 'pendente';
    return true;
  }

  function clientsStats(items) {
    let activo = 0, aExpirar = 0, expirado = 0, divida = 0, pendente = 0;
    items.forEach(c => {
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

  function renderClients() {
    const list = $('#clientsList');
    if (!list) return;
    const raw = store.clients || [];
    const items = raw.map(enrichClient);

    // Sort: debt first, then expiring, then by planEnd ascending
    items.sort((a, b) => {
      const score = (c) => {
        if (c.billingStatus === 'em_divida' || c._expired) return 0;
        if (c._expiringSoon) return 1;
        if (c.membershipStatus === 'pendente') return 2;
        return 3;
      };
      const d = score(a) - score(b);
      if (d !== 0) return d;
      const ae = a.planEnd || '9999';
      const be = b.planEnd || '9999';
      return ae < be ? -1 : ae > be ? 1 : 0;
    });

    const stats = clientsStats(items);
    updateClientsNavBadge(stats);

    const summary = $('#clientsSummary');
    if (summary) {
      summary.innerHTML = `
        <div class="stat ok"><strong>${stats.activo}</strong><span>Activos</span></div>
        <div class="stat warn"><strong>${stats.aExpirar}</strong><span>A expirar (7d)</span></div>
        <div class="stat danger"><strong>${stats.expirado}</strong><span>Expirados</span></div>
        <div class="stat danger"><strong>${stats.divida}</strong><span>Em dívida</span></div>
        <div class="stat"><strong>${stats.pendente}</strong><span>Pendentes</span></div>
      `;
    }

    const filtered = items.filter(c => clientMatchesFilter(c, clientsFilter));
    if (!raw.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhum cliente ainda. Surgem automaticamente das inscrições ou adicione manualmente.</p>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhum cliente neste filtro.</p>';
      return;
    }

    list.innerHTML = filtered.map(c => {
      const days = c._daysLeft;
      let dateLine = '';
      if (c.planStart || c.planEnd) {
        dateLine = formatDatePT(c.planStart) + ' → ' + formatDatePT(c.planEnd);
        if (days !== null) {
          if (days < 0) dateLine += ' · há ' + Math.abs(days) + ' dia(s)';
          else if (days === 0) dateLine += ' · vence hoje';
          else dateLine += ' · ' + days + ' dia(s)';
        }
      }
      const bill = c.billingStatus || 'em_dia';
      const mem = c.membershipStatus || 'pendente';
      const cardClass = (bill === 'em_divida' || c._expired)
        ? 'prod-card card-debt'
        : (c._expiringSoon ? 'prod-card card-expiring' : 'prod-card');
      const price = c.price != null && c.price !== ''
        ? Number(c.price).toLocaleString('pt') + ' Kz'
        : '';
      return `
        <div class="${cardClass}">
          <h3>${escapeHtml(c.name || '—')}
            <span class="status-badge status-${mem}">${mem}</span>
            <span class="status-badge status-${bill}">${bill.replace('_', ' ')}</span>
            ${c._expiringSoon && !c._expired ? '<span class="status-badge status-a_expirar">a expirar</span>' : ''}
          </h3>
          <div class="meta">${escapeHtml(c.phone || '')} · ${escapeHtml(c.email || '')} · ${escapeHtml(c.area || '')}</div>
          <div class="meta">${escapeHtml(c.planName || c.planId || 'Sem plano')}${price ? ' · ' + price : ''}${c.billingCycle ? ' · ' + c.billingCycle : ''}</div>
          ${dateLine ? '<div class="meta">' + dateLine + '</div>' : ''}
          ${c.notes ? '<p style="font-size:0.85rem;margin:0.4rem 0;color:#444">' + escapeHtml(c.notes) + '</p>' : ''}
          <div class="actions">
            <button type="button" data-edit-cli="${c.id}">Editar</button>
            <button type="button" data-renew-cli="${c.id}">Renovar período</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-edit-cli]').forEach(btn => {
      btn.addEventListener('click', () => openClientModal(btn.dataset.editCli));
    });
    list.querySelectorAll('[data-renew-cli]').forEach(btn => {
      btn.addEventListener('click', () => quickRenewClient(btn.dataset.renewCli));
    });
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

  function openClientModal(id) {
    editingClientId = id || null;
    const c = id ? (store.clients || []).find(x => x.id === id) : null;
    const title = $('#clientModalTitle');
    if (title) title.textContent = c ? 'Editar cliente' : 'Novo cliente';
    $('#cName').value = c?.name || '';
    $('#cPhone').value = c?.phone || '';
    $('#cEmail').value = c?.email || '';
    $('#cArea').value = c?.area || 'ginasio';
    $('#cPlan').value = c?.planName || c?.planId || '';
    $('#cPrice').value = c?.price != null ? c.price : '';
    $('#cCycle').value = c?.billingCycle || 'mensal';
    $('#cPlanStart').value = c?.planStart || '';
    $('#cPlanEnd').value = c?.planEnd || '';
    $('#cMembership').value = c?.membershipStatus || 'pendente';
    $('#cBilling').value = (c?.billingStatus === 'atrasado' ? 'em_divida' : (c?.billingStatus || 'em_dia'));
    $('#cNotes').value = c?.notes || '';
    $('#cPayAmount').value = c?.price != null ? c.price : '';
    $('#cPayMethod').value = 'cash';
    $('#cPayNote').value = '';
    renderPayHistory(c?.payments);
    const payBlock = $('#paymentBlock');
    if (payBlock) payBlock.style.display = id ? '' : 'none';
    $('#clientModal').classList.add('open');
  }

  function readClientForm(existing) {
    const priceVal = $('#cPrice').value;
    const data = {
      id: editingClientId || ('cli-' + Date.now()),
      name: $('#cName').value.trim(),
      phone: $('#cPhone').value.trim(),
      email: $('#cEmail').value.trim(),
      area: $('#cArea').value,
      planName: $('#cPlan').value.trim(),
      planId: existing?.planId || '',
      price: priceVal === '' ? null : Number(priceVal),
      billingCycle: $('#cCycle').value,
      planStart: $('#cPlanStart').value || null,
      planEnd: $('#cPlanEnd').value || null,
      membershipStatus: $('#cMembership').value,
      billingStatus: $('#cBilling').value,
      notes: $('#cNotes').value.trim(),
      payments: existing?.payments || [],
      lastPaymentAt: existing?.lastPaymentAt || null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      fromSubmission: existing?.fromSubmission || null
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

  $('#closeClientModal')?.addEventListener('click', () => $('#clientModal').classList.remove('open'));
  $('#addClientBtn')?.addEventListener('click', () => openClientModal(null));

  $('#clientFilters')?.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      clientsFilter = btn.dataset.filter;
      $('#clientFilters').querySelectorAll('[data-filter]').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === clientsFilter);
      });
      renderClients();
    });
  });

  $('#saveClientBtn')?.addEventListener('click', async () => {
    const existing = editingClientId
      ? (store.clients || []).find(x => x.id === editingClientId)
      : null;
    const data = readClientForm(existing);
    if (!data.name) return toast('Nome obrigatório');
    await adminAction('update_client', data);
    $('#clientModal').classList.remove('open');
    toast('Cliente guardado');
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

  // —— Products (same as before) ——
  function renderProducts() {
    const list = $('#prodList');
    if (!list) return;
    const sorted = products.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    list.innerHTML = sorted.map(p => `
      <div class="prod-card">
        <h3>${p.name} ${p.featured ? '★' : ''}</h3>
        <div class="meta">${p.category} · ${Number(p.price).toLocaleString('pt')} Kz · ${p.period || ''} ${p.active === false ? '· <em>inactivo</em>' : ''}</div>
        <div class="actions">
          <button type="button" data-edit="${p.id}">Editar</button>
          <button type="button" class="danger" data-del="${p.id}">Apagar</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openProductModal(btn.dataset.edit));
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Apagar este plano?')) {
          products = products.filter(x => x.id !== btn.dataset.del);
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
    $('#fPeriod').value = p?.period || 'mensal';
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
      if (idx >= 0) products[idx] = data;
    } else {
      products.push(data);
    }
    $('#prodModal').classList.remove('open');
    renderProducts();
    toast('Plano actualizado (ainda rascunho)');
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
    if (!confirm('Publicar na loja?\n\nActualiza planos, textos e imagens para todos os visitantes.')) return;
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
      toast('Publicado com sucesso — todos os browsers verão isto após refresh');
    } catch (err) {
      toast('Erro ao publicar: ' + (err.message || err));
    }
  }

  $('#saveDraftBtn')?.addEventListener('click', saveDraft);
  $('#publishBtn')?.addEventListener('click', publish);

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

  checkAuth();
})();
