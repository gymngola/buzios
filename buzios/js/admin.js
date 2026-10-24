/**
 * Búzios Admin — CRUD for plans, site images, texts, publish via Worker
 */
(function () {
  'use strict';

  // —— Config (edit for new clients) ——
  const ADMIN_PASSWORD = 'buzios2026';           // Change after handoff
  const PUBLISH_URL = 'https://buzios-publish.gymngola.workers.dev/publish';
  const CLOUD_NAME = 'ogtzpc3v';
  const UPLOAD_PRESET = 'buzios_unsigned';       // Create unsigned preset in Cloudinary
  const CATALOG_FOLDER = 'buzios';
  const SITE_IMAGE_SLOTS = [
    { key: 'hero', label: 'Hero (página inicial)' },
    { key: 'intro', label: 'Secção Sobre / Intro' },
    { key: 'ginasio', label: 'Página Ginásio' },
    { key: 'natacao', label: 'Página Natação' },
    { key: 'promo', label: 'Promo / banner extra' }
  ];

  const LS = {
    auth: 'buzios_admin_auth',
    products: 'buzios_products_override',
    texts: 'buzios_texts_override',
    images: 'buzios_images_override',
    media: 'buzios_media_library'
  };

  // —— State ——
  let products = [];
  let texts = { pt: {}, en: {} };
  let images = {};
  let mediaLibrary = [];
  let editingId = null;

  // —— DOM ——
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
  }

  // —— Auth ——
  function checkAuth() {
    if (sessionStorage.getItem(LS.auth) === '1' || localStorage.getItem(LS.auth) === '1') {
      showApp();
    }
  }
  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    loadState();
    renderAll();
  }
  $('#loginBtn').addEventListener('click', () => {
    const pass = $('#adminPass').value;
    if (pass === ADMIN_PASSWORD) {
      sessionStorage.setItem(LS.auth, '1');
      showApp();
    } else {
      $('#loginError').style.display = 'block';
    }
  });
  $('#adminPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginBtn').click();
  });

  // —— Tabs ——
  $$('.admin-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.admin-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.panel').forEach(p => p.classList.remove('active'));
      const panel = $('#panel-' + btn.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });

  // —— Load / save local state ——
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

  function saveDraft() {
    localStorage.setItem(LS.products, JSON.stringify(products));
    localStorage.setItem(LS.texts, JSON.stringify(texts));
    localStorage.setItem(LS.images, JSON.stringify(images));
    localStorage.setItem(LS.media, JSON.stringify(mediaLibrary));
    toast('Rascunho guardado neste browser');
  }

  // —— Render products ——
  function renderProducts() {
    const list = $('#prodList');
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

  $('#closeProdModal').addEventListener('click', () => $('#prodModal').classList.remove('open'));
  $('#addProductBtn').addEventListener('click', () => openProductModal(null));
  $('#saveProdBtn').addEventListener('click', () => {
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
    el.innerHTML = SITE_IMAGE_SLOTS.map(slot => {
      const url = images[slot.key] || '';
      return `
        <div class="img-slot" data-key="${slot.key}">
          <strong style="font-size:0.85rem">${slot.label}</strong>
          ${url ? `<img src="${url}" alt="">` : '<div style="height:80px;background:#eee;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;font-size:0.8rem">Sem imagem</div>'}
          <div class="slot-actions">
            <button type="button" data-upload="${slot.key}">Carregar</button>
            <button type="button" data-pick="${slot.key}">Escolher da média</button>
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
            toast('Erro no upload: ' + (err.message || err));
          }
        };
        input.click();
      });
    });
    el.querySelectorAll('[data-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!mediaLibrary.length) return toast('Biblioteca vazia — carregue primeiro');
        const url = prompt('Cole a URL da imagem da biblioteca ou escolha pelo índice 0-' + (mediaLibrary.length - 1));
        if (url == null) return;
        if (/^\d+$/.test(url)) {
          const item = mediaLibrary[Number(url)];
          if (item) images[btn.dataset.pick] = item.url;
        } else if (url.startsWith('http')) {
          images[btn.dataset.pick] = url;
        }
        renderImageSlots();
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
    el.innerHTML = mediaLibrary.map((m, i) => `
      <div style="position:relative">
        <img src="${m.url}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" title="Clique para copiar URL" data-url="${m.url}">
        <button type="button" data-rm="${i}" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;font-size:12px;cursor:pointer">×</button>
      </div>
    `).join('');
    el.querySelectorAll('[data-url]').forEach(img => {
      img.addEventListener('click', () => {
        navigator.clipboard?.writeText(img.dataset.url);
        toast('URL copiada');
      });
    });
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
      toast('Erro: ' + (err.message || err));
    }
    e.target.value = '';
  });

  async function uploadToCloudinary(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', UPLOAD_PRESET);
    fd.append('folder', CATALOG_FOLDER);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || res.statusText);
    }
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
    if (!confirm('Publicar na loja?\n\nIsto actualiza planos, textos e imagens para todos os visitantes.')) return;

    // Collect current text values
    $$('[data-text-key]').forEach(ta => {
      if (!texts.pt) texts.pt = {};
      texts.pt[ta.dataset.textKey] = ta.value;
    });

    const catalog = {
      updatedAt: new Date().toISOString(),
      products,
      zones: [],
      texts,
      images
    };

    if (!PUBLISH_URL) {
      // Fallback: save as draft only + instruct
      saveDraft();
      toast('PUBLISH_URL não configurado. Rascunho guardado. Configure o Worker.');
      console.log('Catalog to publish:', catalog);
      return;
    }

    try {
      toast('A publicar…');
      const res = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, catalog })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || res.statusText);
      }
      // Also keep local draft in sync
      saveDraft();
      toast('Publicado com sucesso');
    } catch (err) {
      toast('Erro ao publicar: ' + (err.message || err));
    }
  }

  // —— Buttons ——
  $('#saveDraftBtn').addEventListener('click', saveDraft);
  $('#publishBtn').addEventListener('click', publish);

  function renderAll() {
    renderProducts();
    renderImageSlots();
    renderMediaLibrary();
    renderTexts();
  }

  // Init
  checkAuth();
})();
