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
  const SITE_IMAGE_SLOTS = [
    { key: 'hero', label: 'Hero 1 (página inicial)' },
    { key: 'hero2', label: 'Hero 2 (página inicial)' },
    { key: 'intro', label: 'Secção Sobre / Intro' },
    { key: 'services', label: 'Secção “O que oferecemos” (fundo)' },
    { key: 'cta', label: 'CTA “Pronto para começar?”' },
    { key: 'ginasio', label: 'Página Ginásio (hero)' },
    { key: 'ginasio_equip1', label: 'Ginásio — Equipamento (foto 1)' },
    { key: 'ginasio_equip2', label: 'Ginásio — Equipamento (foto 2)' },
    { key: 'ginasio_equip3', label: 'Ginásio — Equipamento (foto 3)' },
    { key: 'natacao', label: 'Página Natação (hero)' },
    { key: 'promo', label: 'Promo / banner extra' }
  ];

  const LS = {
    auth: 'buzios_admin_auth',
    products: 'buzios_products_override',
    texts: 'buzios_texts_override',
    images: 'buzios_images_override',
    media: 'buzios_media_library'
  };

  let products = [];
  let texts = { pt: {}, en: {} };
  let images = {};
  let mediaLibrary = [];
  let store = { submissions: [], clients: [], newsletters: [] };
  let editingId = null;
  let editingClientId = null;

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
  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    loadState();
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

  $$('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.admin-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.panel').forEach(p => p.classList.remove('active'));
      const panel = $('#panel-' + btn.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });

  function loadState() {
    try {
      const p = localStorage.getItem(LS.products);
      products = p ? JSON.parse(p) : (window.DEFAULT_PRODUCTS || []).map(x => ({ ...x }));
    } catch (e) {
      products = (window.DEFAULT_PRODUCTS || []).map(x => ({ ...x }));
    }
    try {
      const t = localStorage.getItem(LS.texts);
      texts = t ? JSON.parse(t) : JSON.parse(JSON.stringify(window.DEFAULT_TEXTS || { pt: {}, en: {} }));
    } catch (e) {
      texts = JSON.parse(JSON.stringify(window.DEFAULT_TEXTS || { pt: {}, en: {} }));
    }
    try {
      const i = localStorage.getItem(LS.images);
      images = i ? JSON.parse(i) : Object.assign({}, window.DEFAULT_SITE_IMAGES || {});
    } catch (e) {
      images = Object.assign({}, window.DEFAULT_SITE_IMAGES || {});
    }
    try {
      mediaLibrary = JSON.parse(localStorage.getItem(LS.media) || '[]');
    } catch (e) {
      mediaLibrary = [];
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
    renderNewsletters();
    renderClients();
  }

  function saveDraft() {
    localStorage.setItem(LS.products, JSON.stringify(products));
    localStorage.setItem(LS.texts, JSON.stringify(texts));
    localStorage.setItem(LS.images, JSON.stringify(images));
    localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
    toast('Rascunho guardado neste browser');
  }

  // —— Inbox ——
  function renderInbox() {
    const list = $('#inboxList');
    if (!list) return;
    const items = store.submissions || [];
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhuma inscrição ou mensagem ainda.</p>';
      return;
    }
    list.innerHTML = items.map(s => {
      const status = s.status || 'novo';
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString('pt') : '';
      const typeLabel = s.type === 'enrollment' ? 'Inscrição' : (s.type === 'contact' ? 'Contacto' : s.type);
      return `
        <div class="prod-card">
          <h3>${s.name || '—'} <span class="status-badge status-${status}">${status}</span></h3>
          <div class="meta">${typeLabel} · ${s.phone || ''} · ${when}</div>
          <div class="meta" style="margin-top:0.35rem">
            ${s.area ? 'Área: ' + s.area + ' · ' : ''}
            ${s.planName || s.planId || ''}
            ${s.subject ? 'Assunto: ' + s.subject : ''}
          </div>
          ${s.notes || s.message ? '<p style="font-size:0.85rem;margin:0.5rem 0;color:#444">' + (s.notes || s.message) + '</p>' : ''}
          ${s.attachments && s.attachments.length ? '<div class="meta">Anexos: ' + s.attachments.map((u,i) => '<a href="'+u+'" target="_blank">doc'+(i+1)+'</a>').join(', ') + '</div>' : ''}
          <div class="actions" style="margin-top:0.65rem">
            <button type="button" data-st="${s.id}" data-v="contactado">Contactado</button>
            <button type="button" data-st="${s.id}" data-v="inscrito">Inscrito</button>
            <button type="button" data-st="${s.id}" data-v="arquivado">Arquivar</button>
            <button type="button" class="danger" data-del-sub="${s.id}">Apagar</button>
          </div>
        </div>`;
    }).join('');

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

  // —— Clients ——
  function renderClients() {
    const list = $('#clientsList');
    if (!list) return;
    const items = store.clients || [];
    if (!items.length) {
      list.innerHTML = '<p style="color:#666;font-size:0.9rem">Nenhum cliente ainda. Surgem automaticamente das inscrições.</p>';
      return;
    }
    list.innerHTML = items.map(c => `
      <div class="prod-card">
        <h3>${c.name || '—'} <span class="status-badge status-${c.membershipStatus || 'pendente'}">${c.membershipStatus || 'pendente'}</span></h3>
        <div class="meta">${c.phone || ''} · ${c.email || ''} · ${c.area || ''}</div>
        <div class="meta">${c.planName || c.planId || ''} · Faturação: ${c.billingStatus || 'em_dia'}</div>
        ${c.notes ? '<p style="font-size:0.85rem;margin:0.4rem 0;color:#444">' + c.notes + '</p>' : ''}
        <div class="actions">
          <button type="button" data-edit-cli="${c.id}">Editar</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-edit-cli]').forEach(btn => {
      btn.addEventListener('click', () => openClientModal(btn.dataset.editCli));
    });
  }

  function openClientModal(id) {
    editingClientId = id || null;
    const c = id ? (store.clients || []).find(x => x.id === id) : null;
    $('#cName').value = c?.name || '';
    $('#cPhone').value = c?.phone || '';
    $('#cEmail').value = c?.email || '';
    $('#cArea').value = c?.area || 'ginasio';
    $('#cPlan').value = c?.planName || c?.planId || '';
    $('#cMembership').value = c?.membershipStatus || 'pendente';
    $('#cBilling').value = c?.billingStatus || 'em_dia';
    $('#cNotes').value = c?.notes || '';
    $('#clientModal').classList.add('open');
  }
  $('#closeClientModal')?.addEventListener('click', () => $('#clientModal').classList.remove('open'));
  $('#addClientBtn')?.addEventListener('click', () => openClientModal(null));
  $('#saveClientBtn')?.addEventListener('click', async () => {
    const data = {
      id: editingClientId || ('cli-' + Date.now()),
      name: $('#cName').value.trim(),
      phone: $('#cPhone').value.trim(),
      email: $('#cEmail').value.trim(),
      area: $('#cArea').value,
      planName: $('#cPlan').value.trim(),
      membershipStatus: $('#cMembership').value,
      billingStatus: $('#cBilling').value,
      notes: $('#cNotes').value.trim(),
      createdAt: editingClientId ? undefined : new Date().toISOString()
    };
    await adminAction('update_client', data);
    $('#clientModal').classList.remove('open');
    toast('Cliente guardado');
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
      return `
        <div class="img-slot" data-key="${slot.key}">
          <strong style="font-size:0.85rem">${slot.label}</strong>
          ${url ? `<img src="${url}" alt="">` : '<div style="height:80px;background:#eee;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;font-size:0.8rem">Sem imagem</div>'}
          <div class="slot-actions">
            <button type="button" data-upload="${slot.key}">Carregar</button>
            <button type="button" data-clear="${slot.key}">Original</button>
          </div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-upload]').forEach(btn => {
      btn.addEventListener('click', () => {
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
            renderImageSlots();
            renderMediaLibrary();
            toast('Imagem carregada');
          } catch (err) {
            toast('Erro no upload');
          }
        };
        input.click();
      });
    });
    el.querySelectorAll('[data-clear]').forEach(btn => {
      btn.addEventListener('click', () => {
        delete images[btn.dataset.clear];
        renderImageSlots();
      });
    });
  }

  function renderMediaLibrary() {
    const el = $('#mediaLibrary');
    if (!el) return;
    el.innerHTML = mediaLibrary.map((m, i) => `
      <div style="position:relative">
        <img src="${m.url}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px">
        <button type="button" data-rm="${i}" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;font-size:12px;cursor:pointer">×</button>
      </div>
    `).join('');
    el.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        mediaLibrary.splice(Number(btn.dataset.rm), 1);
        renderMediaLibrary();
      });
    });
  }

  $('#mediaUpload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast('A carregar…');
    try {
      const url = await uploadToCloudinary(file);
      mediaLibrary.unshift({ url, name: file.name, at: Date.now() });
      renderMediaLibrary();
      toast('Adicionado à biblioteca');
    } catch (err) {
      toast('Erro no upload');
    }
    e.target.value = '';
  });

  async function uploadToCloudinary(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', UPLOAD_PRESET);
    fd.append('folder', CATALOG_FOLDER);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST', body: fd
    });
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
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
    const catalog = {
      updatedAt: new Date().toISOString(),
      products, zones: [], texts, images
    };
    try {
      toast('A publicar…');
      const res = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, catalog })
      });
      if (!res.ok) throw new Error(await res.text());
      saveDraft();
      toast('Publicado com sucesso');
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
    renderNewsletters();
    renderClients();
  }

  checkAuth();
})();
