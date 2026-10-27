/**
 * Búzios Health Club — Public site logic
 * Header, drawer, i18n, catalog load, site images, plans rendering
 */

(function () {
  'use strict';

  // —— Config ——
  const CLOUD_NAME = 'ogtzpc3v';
  const CATALOG_FOLDER = 'buzios';
  const CATALOG_JSON_URL = `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${CATALOG_FOLDER}/catalog.json`;
  const SUBMIT_URL = 'https://buzios-publish.gymngola.workers.dev/submit';
  const WHATSAPP = '244923423142';
  const LS_CART = 'buzios_cart';
  const LS_PRODUCTS = 'buzios_products_override';
  const LS_TEXTS = 'buzios_texts_override';
  const LS_IMAGES = 'buzios_images_override';
  const LS_IMAGES_CACHE = 'buzios_images_cache';
  const LS_LANG = 'buzios_lang';

  // —— State ——
  let products = window.DEFAULT_PRODUCTS || [];
  let texts = window.DEFAULT_TEXTS || { pt: {}, en: {} };
  let siteImages = Object.assign({}, window.DEFAULT_SITE_IMAGES || {});
  let lang = localStorage.getItem(LS_LANG) || 'pt';

  // —— Helpers ——
  function $(sel, ctx = document) { return ctx.querySelector(sel); }
  function $$(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); }

  function formatPrice(value) {
    return new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 0 }).format(value) + ' Kz';
  }

  // —— Header scroll & announce bar ——
  function initHeader() {
    const header = $('#siteHeader');
    const announce = $('#announceBar');
    if (!header) return;

    let lastY = 0;
    let ticking = false;
    const ANNOUNCE_H = 36;

    function setAnnounceVisible(visible) {
      if (!announce) return;
      if (visible) {
        announce.classList.remove('hide');
        header.style.top = ANNOUNCE_H + 'px';
      } else {
        announce.classList.add('hide');
        header.style.top = '0';
      }
    }

    function onScroll() {
      const y = window.scrollY || window.pageYOffset;
      if (!ticking) {
        window.requestAnimationFrame(() => {
          // Header solid after any scroll
          if (y > 20) {
            header.classList.add('scrolled');
          } else {
            header.classList.remove('scrolled');
          }
          // Announce: hide on scroll down, show near top or on scroll up
          if (announce) {
            if (y < 40) {
              setAnnounceVisible(true);
            } else if (y > lastY && y > 80) {
              setAnnounceVisible(false);
            } else if (y < lastY) {
              setAnnounceVisible(true);
            }
          }
          lastY = y;
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // —— Mobile drawer ——
  function initDrawer() {
    const hamburger = $('#hamburger');
    const drawer = $('#drawer');
    const overlay = $('#drawerOverlay');
    const closeBtn = $('#drawerClose');
    if (!hamburger || !drawer) return;

    function open() {
      hamburger.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      if (overlay) overlay.classList.add('open');
      document.body.classList.add('drawer-open');
    }
    function close() {
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      if (overlay) overlay.classList.remove('open');
      document.body.classList.remove('drawer-open');
    }

    hamburger.addEventListener('click', () => {
      if (drawer.classList.contains('open')) close();
      else open();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', close);
    // Close on nav link
    $$('.drawer-nav a').forEach(a => a.addEventListener('click', close));
  }

  // —— i18n ——
  function applyTexts() {
    const dict = (texts[lang] || texts.pt || {});
    $$('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] != null) {
        // Support line breaks in titles
        if (el.tagName === 'H1' || el.tagName === 'H2' || el.classList.contains('hero-title')) {
          el.innerHTML = dict[key].replace(/\n/g, '<br>');
        } else {
          el.textContent = dict[key];
        }
      }
    });
    document.documentElement.lang = lang;
  }

  function setLang(next) {
    lang = next;
    localStorage.setItem(LS_LANG, lang);
    applyTexts();
    // Update any lang toggle buttons
    $$('.lang-toggle button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }

  // —— Site images ——
  function applySiteImages() {
    // Merge overrides
    let overrides = {};
    try {
      overrides = JSON.parse(localStorage.getItem(LS_IMAGES) || '{}');
    } catch (e) {}
    const images = Object.assign({}, siteImages, overrides);

    $$('[data-site-img]').forEach(el => {
      const key = el.getAttribute('data-site-img');
      if (images[key]) {
        if (el.tagName === 'IMG') {
          el.src = images[key];
          el.hidden = false;
          el.removeAttribute('hidden');
        } else if (el.tagName === 'VIDEO') {
          el.poster = images[key];
        }
      } else if (key === 'hero2' && el.tagName === 'IMG') {
        el.src = '';
        el.hidden = true;
      }
    });
    $$('[data-site-img-bg]').forEach(el => {
      const key = el.getAttribute('data-site-img-bg');
      if (images[key]) {
        el.style.backgroundImage = `url('${images[key]}')`;
      }
    });
    initHeroSlideshow();
  }

  // —— Hero slideshow (one image after the other) ——
  let heroSlideTimer = null;
  function initHeroSlideshow() {
    const media = document.querySelector('.hero-media');
    if (!media) return;
    const slides = Array.from(media.querySelectorAll('img')).filter(img => img.src && !img.hidden);
    if (slides.length === 0) return;

    // Reset
    if (heroSlideTimer) {
      clearInterval(heroSlideTimer);
      heroSlideTimer = null;
    }
    slides.forEach((img, i) => {
      img.classList.toggle('is-active', i === 0);
    });

    if (slides.length < 2) return;

    let idx = 0;
    heroSlideTimer = setInterval(() => {
      slides[idx].classList.remove('is-active');
      idx = (idx + 1) % slides.length;
      slides[idx].classList.add('is-active');
    }, 4000);
  }

  // —— Catalog load ——
  async function loadCatalog() {
    // 1. Start with defaults
    products = (window.DEFAULT_PRODUCTS || []).slice();
    texts = JSON.parse(JSON.stringify(window.DEFAULT_TEXTS || { pt: {}, en: {} }));
    siteImages = Object.assign({}, window.DEFAULT_SITE_IMAGES || {});

    // 2. Last published images (avoids flash of default on reload)
    try {
      const cached = localStorage.getItem(LS_IMAGES_CACHE);
      if (cached) siteImages = Object.assign(siteImages, JSON.parse(cached));
    } catch (e) {}

    // 3. localStorage drafts (same-browser admin preview)
    try {
      const p = localStorage.getItem(LS_PRODUCTS);
      if (p) products = JSON.parse(p);
    } catch (e) {}
    try {
      const t = localStorage.getItem(LS_TEXTS);
      if (t) texts = JSON.parse(t);
    } catch (e) {}
    try {
      const i = localStorage.getItem(LS_IMAGES);
      if (i) siteImages = Object.assign(siteImages, JSON.parse(i));
    } catch (e) {}

    // Apply immediately from cache/overrides so hero doesn't flash the HTML default
    applySiteImages();

    // 4. Remote catalog
    try {
      const res = await fetch(CATALOG_JSON_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.products) && data.products.length) {
          products = data.products;
        }
        if (data.texts) {
          texts = Object.assign({}, texts, data.texts);
        }
        if (data.images) {
          siteImages = Object.assign({}, siteImages, data.images);
          try {
            localStorage.setItem(LS_IMAGES_CACHE, JSON.stringify(data.images));
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('Catalog fetch failed, using defaults/drafts', err);
    }

    applyTexts();
    applySiteImages();
    renderPlansPreview();
    renderPlansPage();
  }

  // —— Render plans (home preview + planos page) ——
  function getGymPlans() {
    return products
      .filter(p => p.category === 'ginasio' && p.active !== false && ['plano-bronze','plano-prata','plano-platina'].includes(p.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function cardIconSvg(kind) {
    const icons = {
      gym: '<path d="M6.5 6.5v11M17.5 6.5v11M6.5 12h11M4 8.5v7M20 8.5v7M3 10.5h2M3 13.5h2M19 10.5h2M19 13.5h2"/>',
      swim: '<path d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M12 5c1.5 0 3 1.2 3 3.2 0 2.3-3 5.3-3 5.3S9 10.5 9 8.2C9 6.2 10.5 5 12 5z"/>',
      medal: '<circle cx="12" cy="8" r="4"/><path d="M8.5 11.5L6 21l6-3 6 3-2.5-9.5"/><path d="M10 8h4"/>',
      star: '<path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4L7.5 16.7l.9-5L4.8 8.2l5-.7L12 3z"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
    };
    const path = icons[kind] || icons.gym;
    return `<span class="card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
  }

  function planCardIcon(p) {
    const id = (p.id || '').toLowerCase();
    if (id.includes('platina') || id.includes('platinum')) return cardIconSvg('star');
    if (id.includes('prata') || id.includes('silver')) return cardIconSvg('medal');
    if (p.category === 'natacao') return cardIconSvg('swim');
    if (id.includes('ferias') || id.includes('aulas') || id.includes('pacote')) return cardIconSvg('calendar');
    return cardIconSvg('gym');
  }

  function renderPlansPreview() {
    const el = $('#plansPreview');
    if (!el) return;
    const plans = getGymPlans();
    el.innerHTML = plans.map(p => {
      const name = lang === 'en' && p.name_en ? p.name_en : p.name;
      const desc = lang === 'en' && p.description_en ? p.description_en : p.description;
      const feats = (lang === 'en' && p.features_en ? p.features_en : p.features) || [];
      return `
        <article class="card plan-card ${p.featured ? 'featured' : ''}">
          <div class="card-body">
            ${planCardIcon(p)}
            <p class="plan-badge">${p.period || 'mensal'}</p>
            <h3 class="card-title">${name}</h3>
            <p class="card-text">${desc}</p>
            <p class="card-price">${formatPrice(p.price)} <span>/ ${p.period || 'mês'}</span></p>
            <ul class="plan-features">
              ${feats.slice(0, 4).map(f => `<li>${f}</li>`).join('')}
            </ul>
            <a href="inscricao.html?plano=${encodeURIComponent(p.id)}" class="btn btn-primary btn-block">Quero este plano</a>
          </div>
        </article>`;
    }).join('');
  }

  function renderPlansPage() {
    const el = $('#plansGrid');
    if (!el) return;
    const all = products
      .filter(p => p.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    el.innerHTML = all.map(p => {
      const name = lang === 'en' && p.name_en ? p.name_en : p.name;
      const desc = lang === 'en' && p.description_en ? p.description_en : p.description;
      const feats = (lang === 'en' && p.features_en ? p.features_en : p.features) || [];
      const catLabel = p.category === 'natacao' ? 'Natação' : 'Ginásio';
      return `
        <article class="card plan-card ${p.featured ? 'featured' : ''}">
          <div class="card-body">
            ${planCardIcon(p)}
            <p class="plan-badge">${catLabel} · ${p.period || ''}</p>
            <h3 class="card-title">${name}</h3>
            <p class="card-text">${desc}</p>
            <p class="card-price">${formatPrice(p.price)} <span>${p.period ? '/ ' + p.period : ''}</span></p>
            ${feats.length ? `<ul class="plan-features">${feats.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
            <a href="inscricao.html?plano=${encodeURIComponent(p.id)}" class="btn btn-primary btn-block">Inscrever-me</a>
          </div>
        </article>`;
    }).join('');
  }

  // —— Newsletter (WhatsApp number) ——
  function initNewsletter() {
    const form = $('#newsletterForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = $('#newsletterPhone')?.value?.trim();
      if (!phone) return;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'A enviar…'; }
      try {
        const res = await fetch(SUBMIT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'newsletter',
            phone,
            createdAt: new Date().toISOString()
          })
        });
        if (!res.ok) throw new Error('fail');
        form.reset();
        alert('Obrigado! Vamos enviar novidades para o seu WhatsApp.');
      } catch (err) {
        alert('Não foi possível registar agora. Tente novamente ou use o formulário de contacto.');
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Subscrever'; }
    });
  }

  // —— Scroll reveal ——
  function initReveal() {
    const els = $$('.reveal');
    if (!els.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(el => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => io.observe(el));
  }

  // —— Init ——
  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initDrawer();
    initNewsletter();
    initReveal();
    loadCatalog();
  });

  // Expose for debugging / admin preview refresh
  window.BuziosApp = {
    reload: loadCatalog,
    setLang,
    getProducts: () => products,
    formatPrice
  };
})();
