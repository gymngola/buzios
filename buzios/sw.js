/**
 * Búzios Health Club — Service Worker
 * Caches the app shell for installable / offline-capable experience.
 * Network-first for catalog & API; cache-first for static assets.
 */
const CACHE = 'buzios-v1';
const SHELL = [
  '/',
  '/index.html',
  '/ginasio.html',
  '/natacao.html',
  '/planos.html',
  '/inscricao.html',
  '/contacto.html',
  '/admin.html',
  '/css/styles.css',
  '/css/admin.css',
  '/js/app.js',
  '/js/admin.js',
  '/js/products.js',
  '/manifest.json',
  '/admin-manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/admin-192.png',
  '/icons/admin-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin API/worker calls (let them go to network)
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) {
    // Cloudinary / Worker / fonts — network only
    return;
  }

  // HTML pages & catalog-like: network first, fall back to cache
  const isHTML = event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
