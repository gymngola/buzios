/**
 * Búzios Health Club — Public site logic
 * Header, drawer, i18n, catalog load, site images, plans rendering
 */

(function () {
  'use strict';

  // —— Config ——
  const CLOUD_NAME = 'ogtzpc3v';
  const CATALOG_FOLDER = 'buzios';
  // Worker proxy = always fresh (Cloudinary CDN caches catalog.json for ~30 days)
  const CATALOG_JSON_URL = 'https://buzios-publish.gymngola.workers.dev/catalog';
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

    function announceHeight() {
      if (!announce || announce.classList.contains('hide')) return 0;
      return Math.ceil(announce.getBoundingClientRect().height) || 36;
    }

    function syncHeaderOffset() {
      const h = announceHeight();
      header.style.top = h + 'px';
      document.documentElement.style.setProperty('--announce-h', h + 'px');
    }

    function setAnnounceVisible(visible) {
      if (!announce) return;
      if (visible) {
        announce.classList.remove('hide');
      } else {
        announce.classList.add('hide');
      }
      syncHeaderOffset();
    }

    function onScroll() {
      const y = window.scrollY || window.pageYOffset;
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (y > 20) {
            header.classList.add('scrolled');
          } else {
            header.classList.remove('scrolled');
          }
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
    window.addEventListener('resize', () => {
      if (!announce || announce.classList.contains('hide')) return;
      syncHeaderOffset();
    }, { passive: true });
    syncHeaderOffset();
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
    $('#installSiteAppBtnDrawer')?.addEventListener('click', close);
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
  // Uses only in-memory siteImages (set by loadCatalog). Do NOT re-merge
  // localStorage here — that used to put stale drafts on top of the live catalog.
  function applySiteImages() {
    const images = siteImages || {};

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
      } else if ((key === 'hero2' || key.startsWith('ginasio_equip')) && el.tagName === 'IMG') {
        el.src = '';
        el.hidden = true;
      }
    });
    $$('[data-site-img-bg]').forEach(el => {
      const key = el.getAttribute('data-site-img-bg');
      if (images[key]) {
        el.style.backgroundImage = `url('${images[key]}')`;
        el.classList.add('has-photo');
      } else {
        el.style.backgroundImage = '';
        el.classList.remove('has-photo');
      }
    });
    initHeroSlideshow();
    initEquipCarousel();
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

  // —— Ginásio equipamento carousel ——
  let equipTimer = null;
  function initEquipCarousel() {
    const root = document.getElementById('equipCarousel');
    if (!root) return;

    if (equipTimer) {
      clearInterval(equipTimer);
      equipTimer = null;
    }

    const allSlides = Array.from(root.querySelectorAll('.equip-slide'));
    const activeSlides = allSlides.filter(slide => {
      const img = slide.querySelector('img');
      return img && img.getAttribute('src') && !img.hidden;
    });
    const dots = Array.from(root.querySelectorAll('.equip-dot'));
    const prev = root.querySelector('.equip-prev');
    const next = root.querySelector('.equip-next');

    if (!activeSlides.length) {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    allSlides.forEach(s => {
      s.style.display = activeSlides.includes(s) ? '' : 'none';
      s.classList.remove('is-active');
    });
    dots.forEach((d, i) => {
      d.style.display = i < activeSlides.length ? '' : 'none';
      d.classList.remove('is-active');
    });

    let idx = 0;
    function goTo(n) {
      activeSlides[idx]?.classList.remove('is-active');
      dots[idx]?.classList.remove('is-active');
      idx = (n + activeSlides.length) % activeSlides.length;
      activeSlides[idx]?.classList.add('is-active');
      dots[idx]?.classList.add('is-active');
    }
    goTo(0);

    if (prev) prev.onclick = () => goTo(idx - 1);
    if (next) next.onclick = () => goTo(idx + 1);
    dots.forEach((d, i) => {
      d.onclick = () => { if (i < activeSlides.length) goTo(i); };
    });

    function startAuto() {
      if (equipTimer) clearInterval(equipTimer);
      if (activeSlides.length < 2) return;
      equipTimer = setInterval(() => goTo(idx + 1), 4500);
    }
    function stopAuto() {
      if (equipTimer) { clearInterval(equipTimer); equipTimer = null; }
    }
    root.onmouseenter = stopAuto;
    root.onmouseleave = startAuto;
    startAuto();
  }


  // —— Editorial showcases (gym + pool, FS side-peek) ——
  const showcaseTimers = new WeakMap();

  function initOneShowcase(root) {
    if (!root || root.dataset.showcaseReady === '1') return;
    root.dataset.showcaseReady = '1';

    const viewport = root.querySelector('.gym-showcase-viewport') || root;
    const track = root.querySelector('.gym-showcase-track');
    const slides = Array.from(root.querySelectorAll('.gym-showcase-slide'));
    const prev = root.querySelector('.gym-showcase-prev');
    const next = root.querySelector('.gym-showcase-next');
    const titleEl = root.querySelector('.gym-showcase-title') || root.querySelector('#gymShowcaseTitle');
    const textEl = root.querySelector('.gym-showcase-text') || root.querySelector('#gymShowcaseText');
    if (!track || slides.length < 1) return;

    let idx = slides.findIndex(s => s.classList.contains('is-active'));
    if (idx < 0) idx = 0;
    let timer = null;

    function updateCaption(i) {
      const s = slides[i];
      if (!s) return;
      if (titleEl) titleEl.textContent = s.getAttribute('data-caption-title') || '';
      if (textEl) textEl.textContent = s.getAttribute('data-caption-text') || '';
    }

    function layout() {
      const slide = slides[0];
      if (!slide) return;
      const slideW = slide.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const vpW = viewport.getBoundingClientRect().width;
      const offset = (vpW - slideW) / 2 - idx * (slideW + gap);
      track.style.transform = 'translate3d(' + offset + 'px,0,0)';
    }

    function goTo(n) {
      slides[idx]?.classList.remove('is-active');
      idx = (n + slides.length) % slides.length;
      slides[idx]?.classList.add('is-active');
      updateCaption(idx);
      layout();
    }

    if (prev) prev.onclick = (e) => { e.stopPropagation(); goTo(idx - 1); restart(); };
    if (next) next.onclick = (e) => { e.stopPropagation(); goTo(idx + 1); restart(); };

    function startAuto() {
      if (timer) clearInterval(timer);
      if (slides.length < 2) return;
      timer = setInterval(() => goTo(idx + 1), 5200);
      showcaseTimers.set(root, timer);
    }
    function stopAuto() {
      if (timer) { clearInterval(timer); timer = null; }
      showcaseTimers.delete(root);
    }
    function restart() { stopAuto(); startAuto(); }

    root.onmouseenter = stopAuto;
    root.onmouseleave = startAuto;
    root.addEventListener('focusin', stopAuto);
    root.addEventListener('focusout', startAuto);
    window.addEventListener('resize', layout);

    let touchX = null;
    viewport.addEventListener('touchstart', (e) => {
      touchX = e.changedTouches[0].clientX;
      stopAuto();
    }, { passive: true });
    viewport.addEventListener('touchend', (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) goTo(dx < 0 ? idx + 1 : idx - 1);
      startAuto();
    }, { passive: true });

    updateCaption(idx);
    layout();
    requestAnimationFrame(layout);
    startAuto();
  }

  function initGymShowcase() {
    document.querySelectorAll('.gym-showcase').forEach(initOneShowcase);
  }

  // —— Gym image lightbox (full uncropped view) ——
  function initGymLightbox() {
    const lb = document.getElementById('gymLightbox');
    if (!lb) return;
    const imgEl = document.getElementById('gymLightboxImg');
    const capEl = document.getElementById('gymLightboxCaption');
    const closeBtn = document.getElementById('gymLightboxClose');
    let lastFocus = null;

    function open(src, alt, caption) {
      if (!src) return;
      lastFocus = document.activeElement;
      imgEl.src = src;
      imgEl.alt = alt || '';
      if (caption) {
        capEl.textContent = caption;
        capEl.hidden = false;
      } else {
        capEl.textContent = '';
        capEl.hidden = true;
      }
      lb.hidden = false;
      lb.setAttribute('aria-hidden', 'false');
      // force reflow then open for transition
      void lb.offsetWidth;
      lb.classList.add('is-open');
      document.body.classList.add('gym-lightbox-open');
      closeBtn?.focus();
    }

    function close() {
      lb.classList.remove('is-open');
      document.body.classList.remove('gym-lightbox-open');
      lb.setAttribute('aria-hidden', 'true');
      const onEnd = () => {
        lb.hidden = true;
        imgEl.removeAttribute('src');
        lb.removeEventListener('transitionend', onEnd);
      };
      lb.addEventListener('transitionend', onEnd);
      // fallback if no transition
      setTimeout(() => {
        if (!lb.classList.contains('is-open')) {
          lb.hidden = true;
          if (imgEl.getAttribute('src')) imgEl.removeAttribute('src');
        }
      }, 350);
      if (lastFocus && typeof lastFocus.focus === 'function') {
        try { lastFocus.focus(); } catch (_) {}
      }
    }

    closeBtn?.addEventListener('click', close);
    lb.addEventListener('click', (e) => {
      if (e.target === lb) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lb.classList.contains('is-open')) close();
    });

    // Showcase slides (gym + pool)
    document.querySelectorAll('.gym-showcase').forEach((showcase) => {
      showcase.querySelectorAll('.gym-showcase-slide').forEach((slide) => {
        const img = slide.querySelector('img');
        if (!img) return;
        const openFromSlide = (e) => {
          if (e.target.closest('.gym-showcase-nav')) return;
          e.preventDefault();
          const t = slide.getAttribute('data-caption-title') || '';
          const d = slide.getAttribute('data-caption-text') || '';
          const cap = [t, d].filter(Boolean).join(' — ');
          open(img.currentSrc || img.src, img.alt, cap);
        };
        slide.addEventListener('click', openFromSlide);
      });
    });

    // Equipment grid cards
    document.querySelectorAll('.gym-equip-card-media').forEach((media) => {
      const img = media.querySelector('img');
      if (!img) return;
      media.setAttribute('role', 'button');
      media.setAttribute('tabindex', '0');
      media.setAttribute('aria-label', 'Ver imagem completa');
      const openCard = () => {
        const card = media.closest('.gym-equip-card');
        const title = card?.querySelector('.gym-equip-card-title')?.textContent || '';
        open(img.currentSrc || img.src, img.alt, title);
      };
      media.addEventListener('click', (e) => {
        e.preventDefault();
        openCard();
      });
      media.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCard();
        }
      });
    });
  }

  // —— Catalog load ——
  // Order: defaults → image cache (no flash) → optional same-browser draft → remote catalog wins.
  async function loadCatalog() {
    // 1. Defaults
    products = (window.DEFAULT_PRODUCTS || []).slice();
    texts = JSON.parse(JSON.stringify(window.DEFAULT_TEXTS || { pt: {}, en: {} }));
    siteImages = Object.assign({}, window.DEFAULT_SITE_IMAGES || {});

    // 2. Last published image cache (avoids flash of Unsplash on reload)
    try {
      const cached = localStorage.getItem(LS_IMAGES_CACHE);
      if (cached) {
        const c = JSON.parse(cached);
        Object.keys(c).forEach(k => { if (c[k]) siteImages[k] = c[k]; });
      }
    } catch (e) {}

    // 3. Same-browser admin draft (preview only — remote will overwrite)
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
      if (i) {
        const draft = JSON.parse(i);
        Object.keys(draft).forEach(k => { if (draft[k]) siteImages[k] = draft[k]; });
      }
    } catch (e) {}

    applySiteImages();

    // 4. Live catalog — always wins over drafts/cache
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
        if (data.images && typeof data.images === 'object') {
          // Only non-empty remote URLs overwrite (empty string = keep previous)
          Object.keys(data.images).forEach(k => {
            if (data.images[k]) siteImages[k] = data.images[k];
          });
          try {
            localStorage.setItem(LS_IMAGES_CACHE, JSON.stringify(siteImages));
            // Align draft with published so stale Unsplash drafts can't fight the catalog
            localStorage.setItem(LS_IMAGES, JSON.stringify(siteImages));
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

  function planCardHtml(p, opts) {
    opts = opts || {};
    const name = lang === 'en' && p.name_en ? p.name_en : p.name;
    const desc = lang === 'en' && p.description_en ? p.description_en : p.description;
    const feats = (lang === 'en' && p.features_en ? p.features_en : p.features) || [];
    const badge = opts.badge || p.period || '';
    const cta = opts.cta || (lang === 'en' ? 'Enroll' : 'Inscrever-me');
    return `
      <article class="card plan-card ${p.featured ? 'featured' : ''} ${opts.extraClass || ''}">
        <div class="card-body">
          ${planCardIcon(p)}
          <p class="plan-badge">${badge}</p>
          <h3 class="card-title">${name}</h3>
          <p class="card-text">${desc}</p>
          <p class="card-price">${formatPrice(p.price)} <span>${p.period ? '/ ' + p.period : ''}</span></p>
          ${feats.length ? `<ul class="plan-features">${feats.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
          <a href="inscricao.html?plano=${encodeURIComponent(p.id)}" class="btn btn-primary btn-block">${cta}</a>
        </div>
      </article>`;
  }

  function renderPlansPage() {
    const gymEl = $('#plansGridGym');
    const swimEl = $('#plansGridSwim');
    // Legacy single grid fallback
    const legacy = $('#plansGrid');
    if (!gymEl && !swimEl && !legacy) return;

    const active = products
      .filter(p => p.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // Gym: membership plans only (hide one-off fees / extras from the main grid)
    const gym = active.filter(p =>
      p.category === 'ginasio' &&
      ['plano-bronze', 'plano-prata', 'plano-platina'].includes(p.id)
    );
    // Swim grid on planos page = holiday packages only (mensalidades are static below)
    const swim = active.filter(p =>
      p.category === 'natacao' && p.period === 'pacote'
    );

    if (gymEl) {
      gymEl.innerHTML = gym.length
        ? gym.map(p => planCardHtml(p, {
            badge: (lang === 'en' ? 'Gym' : 'Ginásio') + (p.period ? ' · ' + p.period : '')
          })).join('')
        : '<p class="muted text-center">Sem planos de ginásio activos.</p>';
    }
    if (swimEl) {
      swimEl.innerHTML = swim.length
        ? swim.map(p => planCardHtml(p, {
            badge: lang === 'en' ? 'Holiday package' : 'Plano de férias',
            extraClass: 'plan-card--swim'
          })).join('')
        : '<p class="muted text-center">Sem pacotes de férias activos.</p>';
    }
    if (legacy && !gymEl && !swimEl) {
      legacy.innerHTML = active.map(p => planCardHtml(p, {
        badge: (p.category === 'natacao'
          ? (lang === 'en' ? 'Swimming' : 'Natação')
          : (lang === 'en' ? 'Gym' : 'Ginásio')) + (p.period ? ' · ' + p.period : '')
      })).join('');
    }
  }

  // —— Newsletter (WhatsApp number) ——
  function showNewsletterFeedback(kind, message) {
    const el = $('#newsletterFeedback');
    if (!el) return;
    el.hidden = false;
    el.classList.remove('is-success', 'is-error');
    el.classList.add(kind === 'error' ? 'is-error' : 'is-success');
    el.textContent = message;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  function initNewsletter() {
    const form = $('#newsletterForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = $('#newsletterPhone')?.value?.trim();
      if (!phone) return;
      const btn = form.querySelector('button[type="submit"]');
      const feedback = $('#newsletterFeedback');
      if (feedback) {
        feedback.hidden = true;
        feedback.textContent = '';
      }
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
        showNewsletterFeedback('success', 'Obrigado! Vamos enviar novidades para o seu WhatsApp.');
      } catch (err) {
        showNewsletterFeedback('error', 'Não foi possível registar agora. Tente novamente ou use Contacto.');
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

  // —— Install website PWA ——
  let deferredSiteInstall = null;
  const INSTALL_DISMISS_KEY = 'buzios_install_dismissed';

  function isSiteAppInstalled() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.navigator.standalone === true) return true;
    } catch (e) {}
    return false;
  }

  function isIosDevice() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function wasInstallDismissed() {
    try { return sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function markInstallDismissed() {
    try { sessionStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {}
  }

  function updateSiteInstallButtons() {
    const installed = isSiteAppInstalled();
    const canInstall = !installed && !!deferredSiteInstall;

    ['#installSiteAppBtn', '#installSiteAppBtnDrawer'].forEach(sel => {
      const btn = $(sel);
      if (!btn) return;
      btn.classList.toggle('is-installed', installed);
      btn.classList.toggle('can-install', canInstall);

      if (installed) {
        if (btn.id === 'installSiteAppBtnDrawer') {
          btn.innerHTML = '<span class="drawer-install-icon" aria-hidden="true">✓</span> App instalada';
        } else {
          btn.textContent = 'App instalada';
        }
      } else if (canInstall) {
        if (btn.id === 'installSiteAppBtnDrawer') {
          btn.innerHTML = '<span class="drawer-install-icon" aria-hidden="true">↓</span> Instalar app agora';
        } else {
          btn.textContent = 'Instalar app';
        }
      }
    });
  }

  function openSiteInstallModal() {
    const modal = $('#installSiteModal');
    if (!modal) return;
    const body = $('#installSiteBody');
    const steps = $('#installSiteSteps');
    const confirmBtn = $('#installSiteConfirmBtn');

    modal.hidden = false;
    modal.removeAttribute('hidden');

    if (isSiteAppInstalled()) {
      if (body) body.textContent = 'O site já está a correr como aplicação neste dispositivo.';
      if (steps) steps.innerHTML = '';
      if (confirmBtn) confirmBtn.hidden = true;
      return;
    }

    if (deferredSiteInstall) {
      if (body) body.textContent = 'Instale o Búzios no ecrã inicial para abrir mais rápido, como uma app.';
      if (steps) steps.innerHTML = '<li>Toque em <strong>Instalar agora</strong> e confirme no diálogo do browser.</li>';
      if (confirmBtn) confirmBtn.hidden = false;
      return;
    }

    if (isIosDevice()) {
      if (body) body.textContent = 'No iPhone ou iPad, use o Safari:';
      if (steps) steps.innerHTML = [
        '<li>Abra o site no <strong>Safari</strong>.</li>',
        '<li>Toque em <strong>Partilhar</strong> (quadrado com seta).</li>',
        '<li>Escolha <strong>Adicionar ao Ecrã Principal</strong>.</li>',
        '<li>Confirme o nome <strong>Búzios</strong> e toque em Adicionar.</li>'
      ].join('');
    } else {
      if (body) body.textContent = 'Para instalar no telemóvel ou computador:';
      if (steps) steps.innerHTML = [
        '<li>Chrome / Edge: menu (⋮) → <strong>Instalar aplicação</strong> ou <strong>Adicionar ao ecrã inicial</strong>.</li>',
        '<li>Android: menu → <strong>Instalar app</strong>.</li>',
        '<li>É necessário HTTPS. Se a opção não aparecer, visite o site algumas vezes e tente de novo.</li>'
      ].join('');
    }
    if (confirmBtn) confirmBtn.hidden = true;
  }

  function closeSiteInstallModal() {
    const modal = $('#installSiteModal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('hidden', '');
    markInstallDismissed();
  }

  function scheduleSoftInstallPrompt() {
    // Once per session: if browser offers native install, gently show modal after short delay
    if (wasInstallDismissed() || isSiteAppInstalled() || !deferredSiteInstall) return;
    setTimeout(() => {
      if (!deferredSiteInstall || wasInstallDismissed() || isSiteAppInstalled()) return;
      const modal = $('#installSiteModal');
      if (modal && modal.hidden) openSiteInstallModal();
    }, 9000);
  }

  function initInstallSite() {
    updateSiteInstallButtons();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredSiteInstall = e;
      updateSiteInstallButtons();
      scheduleSoftInstallPrompt();
    });
    window.addEventListener('appinstalled', () => {
      deferredSiteInstall = null;
      updateSiteInstallButtons();
      closeSiteInstallModal();
    });

    ['#installSiteAppBtn', '#installSiteAppBtnDrawer'].forEach(sel => {
      $(sel)?.addEventListener('click', openSiteInstallModal);
    });
    $('#installSiteConfirmBtn')?.addEventListener('click', async () => {
      if (!deferredSiteInstall) return;
      deferredSiteInstall.prompt();
      try { await deferredSiteInstall.userChoice; } catch (e) {}
      deferredSiteInstall = null;
      closeSiteInstallModal();
      updateSiteInstallButtons();
    });
    $('#closeInstallSiteModal')?.addEventListener('click', closeSiteInstallModal);
    $('#installSiteDismissBtn')?.addEventListener('click', closeSiteInstallModal);
    $('#installSiteModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeSiteInstallModal();
    });
  }

  // —— Init ——
  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initDrawer();
    initInstallSite();
    initNewsletter();
    initReveal();
    initGymShowcase();
    initGymLightbox();
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
