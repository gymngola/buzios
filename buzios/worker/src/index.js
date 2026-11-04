/**
 * Búzios Publish + Submissions Worker
 *
 * Routes:
 *   POST /publish          — admin: publish catalog (password)
 *   POST /submit           — public: enrollment / contact / newsletter
 *   POST /admin/data       — admin: get or update submissions + clients (password)
 *
 * Secrets:
 *   ADMIN_PASSWORD
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FOLDER = 'buzios';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    try {
      // Fresh catalog (bypasses Cloudinary CDN 30-day cache)
      if (request.method === 'GET' && path === '/catalog') {
        return await handleGetCatalog(env);
      }
      if (request.method === 'POST' && (path === '/publish' || path === '/')) {
        return await handlePublish(request, env);
      }
      if (request.method === 'POST' && path === '/submit') {
        return await handleSubmit(request, env);
      }
      if (request.method === 'POST' && path === '/admin/data') {
        return await handleAdminData(request, env);
      }
      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      return json({ error: err.message || 'Server error' }, 500);
    }
  }
};

/** Always-fresh catalog for public site + admin (no CDN lag). */
async function handleGetCatalog(env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) {
    return json({ error: 'Server misconfigured' }, 500);
  }

  const publicId = FOLDER + '/catalog.json';
  const auth = btoa(apiKey + ':' + apiSecret);

  // Admin API → current version (not CDN-cached)
  const metaRes = await fetch(
    'https://api.cloudinary.com/v1_1/' + cloudName + '/resources/raw/upload/' + encodeURIComponent(publicId),
    { headers: { Authorization: 'Basic ' + auth } }
  );
  if (!metaRes.ok) {
    // Fallback: delivery URL (may be cached)
    const fallback = await fetch(
      'https://res.cloudinary.com/' + cloudName + '/raw/upload/' + publicId + '?_=' + Date.now()
    );
    if (!fallback.ok) return json({ error: 'Catalog not found' }, 404);
    return new Response(await fallback.text(), {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS)
    });
  }
  const meta = await metaRes.json();
  const version = meta.version;
  const versioned =
    'https://res.cloudinary.com/' + cloudName + '/raw/upload/v' + version + '/' + publicId;
  const fileRes = await fetch(versioned);
  if (!fileRes.ok) return json({ error: 'Catalog download failed' }, 502);
  return new Response(await fileRes.text(), {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS)
  });
}

async function handlePublish(request, env) {
  const body = await request.json();
  const { password, catalog } = body || {};
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!catalog || typeof catalog !== 'object') {
    return json({ error: 'Missing catalog' }, 400);
  }
  const result = await uploadRaw(env, FOLDER + '/catalog.json', JSON.stringify(catalog, null, 2));
  return json({
    ok: true,
    url: result.secure_url,
    version: result.version,
    updatedAt: catalog.updatedAt
  });
}

async function handleSubmit(request, env) {
  const payload = await request.json();
  if (!payload || typeof payload !== 'object') {
    return json({ error: 'Invalid body' }, 400);
  }

  const type = payload.type || 'contact';
  const id = payload.id || (type.slice(0, 3) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));

  let store = await loadStore(env);

  if (type === 'newsletter') {
    if (!payload.phone) return json({ error: 'Phone required' }, 400);
    store.newsletters = store.newsletters || [];
    if (!store.newsletters.some(n => n.phone === payload.phone)) {
      store.newsletters.unshift({
        id,
        phone: String(payload.phone).trim(),
        createdAt: payload.createdAt || new Date().toISOString()
      });
    }
  } else if (type === 'enrollment') {
    if (!payload.name || !payload.phone) return json({ error: 'Name and phone required' }, 400);
    store.submissions = store.submissions || [];
    store.submissions.unshift({
      id,
      type: 'enrollment',
      status: 'novo',
      area: payload.area,
      planId: payload.planId || null,
      planIdGym: payload.planIdGym || null,
      planIdSwim: payload.planIdSwim || null,
      planName: payload.planName || '',
      annualFee: !!payload.annualFee,
      extras: payload.extras || [],
      lineItems: payload.lineItems || [],
      estimatedTotal: payload.estimatedTotal != null ? payload.estimatedTotal : null,
      name: payload.name,
      phone: payload.phone,
      email: payload.email || '',
      age: payload.age,
      emergency: payload.emergency || '',
      emergencyName: payload.emergencyName || '',
      emergencyPhone: payload.emergencyPhone || '',
      schedule: payload.schedule || [],
      notes: payload.notes || '',
      docsLater: !!payload.docsLater,
      attachments: payload.attachments || [],
      createdAt: payload.createdAt || new Date().toISOString()
    });
    store.clients = store.clients || [];
    if (!store.clients.some(c => c.phone === payload.phone)) {
      store.clients.unshift({
        id: 'cli-' + Date.now(),
        name: payload.name,
        phone: payload.phone,
        email: payload.email || '',
        area: payload.area || '',
        planId: payload.planId || payload.planIdGym || payload.planIdSwim || '',
        planName: payload.planName || '',
        price: payload.estimatedTotal != null ? payload.estimatedTotal : null,
        billingCycle: 'mensal',
        planStart: null,
        planEnd: null,
        membershipStatus: 'pendente',
        billingStatus: 'em_dia',
        lastPaymentAt: null,
        payments: [],
        notes: payload.notes || '',
        createdAt: new Date().toISOString(),
        fromSubmission: id
      });
    }
  } else {
    if (!payload.name && !payload.phone) return json({ error: 'Name or phone required' }, 400);
    store.submissions = store.submissions || [];
    store.submissions.unshift({
      id,
      type: type || 'contact',
      status: 'novo',
      name: payload.name || '',
      phone: payload.phone || '',
      email: payload.email || '',
      subject: payload.subject || '',
      preferContact: payload.preferContact || '',
      message: payload.message || payload.notes || '',
      createdAt: payload.createdAt || new Date().toISOString()
    });
  }

  if (store.submissions && store.submissions.length > 500) store.submissions = store.submissions.slice(0, 500);
  if (store.newsletters && store.newsletters.length > 1000) store.newsletters = store.newsletters.slice(0, 1000);
  if (store.clients && store.clients.length > 500) store.clients = store.clients.slice(0, 500);

  store.updatedAt = new Date().toISOString();
  await saveStore(env, store);
  return json({ ok: true, id, count: (store.submissions || []).length });
}

async function handleAdminData(request, env) {
  const body = await request.json();
  const { password, action, data } = body || {};
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let store = await loadStore(env);

  if (action === 'get' || !action) {
    return json({ ok: true, store });
  }

  if (action === 'update_submission' && data && data.id) {
    store.submissions = store.submissions || [];
    const idx = store.submissions.findIndex(s => s.id === data.id);
    if (idx >= 0) {
      store.submissions[idx] = Object.assign({}, store.submissions[idx], data, { id: data.id });
    }
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'update_client' && data && data.id) {
    store.clients = store.clients || [];
    const idx = store.clients.findIndex(c => c.id === data.id);
    if (idx >= 0) {
      store.clients[idx] = Object.assign({}, store.clients[idx], data, { id: data.id });
    } else {
      store.clients.unshift(data);
    }
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'delete_submission' && data && data.id) {
    store.submissions = (store.submissions || []).filter(s => s.id !== data.id);
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'delete_newsletter' && data && data.id) {
    store.newsletters = (store.newsletters || []).filter(n => n.id !== data.id);
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'replace_store' && data) {
    store = data;
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  return json({ error: 'Unknown action' }, 400);
}

const STORE_CACHE_URL = 'https://buzios-internal.workers.dev/store.json';

function emptyStore() {
  return { submissions: [], clients: [], newsletters: [], classes: [], updatedAt: null };
}

function storeScore(s) {
  if (!s || typeof s !== 'object') return -1;
  return (s.submissions || []).length + (s.newsletters || []).length + (s.clients || []).length;
}

/** True when snapshot has no real data (uninitialized or wiped). */
function isEmptyStore(s) {
  if (!s || typeof s !== 'object') return true;
  return storeScore(s) <= 0 && !s.updatedAt;
}

/** Prefer the richer / newer of two store snapshots. Never prefer empty over real data. */
function preferStore(a, b) {
  if (!a || isEmptyStore(a)) return b && !isEmptyStore(b) ? b : (b || a || emptyStore());
  if (!b || isEmptyStore(b)) return a;
  const sa = storeScore(a);
  const sb = storeScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  const ta = Date.parse(a.updatedAt || 0) || 0;
  const tb = Date.parse(b.updatedAt || 0) || 0;
  return ta >= tb ? a : b;
}

async function putStoreCache(store) {
  try {
    await caches.default.put(
      STORE_CACHE_URL,
      new Response(JSON.stringify(store), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=604800' }
      })
    );
  } catch (_) {}
}

async function loadStoreFromCache() {
  try {
    const hit = await caches.default.match(STORE_CACHE_URL);
    if (hit) {
      const data = await hit.json();
      if (data && typeof data === 'object') return data;
    }
  } catch (_) {}
  return null;
}

function looksLikeStore(data) {
  return (
    data &&
    typeof data === 'object' &&
    (Array.isArray(data.submissions) ||
      Array.isArray(data.newsletters) ||
      Array.isArray(data.clients) ||
      data.updatedAt != null)
  );
}

async function fetchStoreJson(url) {
  const bust = (url.includes('?') ? '&' : '?') + '_=' + Date.now() + '&cb=' + Math.random().toString(36).slice(2, 8);
  const res = await fetch(url + bust, {
    cache: 'no-store',
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return looksLikeStore(data) ? data : null;
}

async function loadStoreFromCloudinary(env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName) return null;

  const publicId = FOLDER + '/store.json';
  const urls = [];

  // Admin API → versioned / secure_url (avoids 30-day delivery CDN)
  if (apiKey && apiSecret) {
    try {
      const auth = btoa(apiKey + ':' + apiSecret);
      const metaRes = await fetch(
        'https://api.cloudinary.com/v1_1/' + cloudName + '/resources/raw/upload/' + encodeURIComponent(publicId),
        { headers: { Authorization: 'Basic ' + auth } }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.secure_url) urls.push(meta.secure_url);
        if (meta.url) urls.push(String(meta.url).replace(/^http:/, 'https:'));
        if (meta.version) {
          urls.push(
            'https://res.cloudinary.com/' + cloudName + '/raw/upload/v' + meta.version + '/' + publicId
          );
        }
      }
    } catch (_) {}
  }

  // Always try plain delivery as last resort (cache-busted)
  urls.push('https://res.cloudinary.com/' + cloudName + '/raw/upload/' + publicId);

  for (const u of urls) {
    try {
      const data = await fetchStoreJson(u);
      if (data) return data;
    } catch (_) {}
  }

  return null;
}

/**
 * Load store: Workers Cache (fast, same-colo) + Cloudinary (durable).
 * Picks the richer snapshot so CDN lag / empty colo cache cannot wipe data.
 * Always backfills Cache when Cloudinary wins.
 */
async function loadStore(env) {
  const fromCache = await loadStoreFromCache();
  const fromCloud = await loadStoreFromCloudinary(env);
  const chosen = preferStore(fromCache, fromCloud);

  // If cache was empty/stale and we got real data from Cloudinary, fix this colo's cache
  if (!isEmptyStore(chosen) && (isEmptyStore(fromCache) || storeScore(chosen) > storeScore(fromCache || emptyStore()))) {
    await putStoreCache(chosen);
  }

  return chosen || emptyStore();
}

async function saveStore(env, store) {
  const body = JSON.stringify(store);
  // 1. Workers Cache — immediate read for this colo
  await putStoreCache(store);
  // 2. Cloudinary — durable backup (invalidate CDN)
  await uploadRaw(env, FOLDER + '/store.json', body);
}

async function uploadRaw(env, publicId, content) {
  // Trim secrets — trailing newlines from `wrangler secret put` break signatures
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Server misconfigured (missing Cloudinary secrets)');
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Params included in the signature (alphabetical). Never include file, api_key,
  // cloud_name, or resource_type. Then append api_secret with no separator.
  // invalidate=true asks Cloudinary to purge CDN cache for this public_id.
  const signParams = {
    invalidate: 'true',
    overwrite: 'true',
    public_id: publicId,
    timestamp: String(timestamp)
  };
  const toSign =
    Object.keys(signParams)
      .sort()
      .map((k) => k + '=' + signParams[k])
      .join('&') + apiSecret;
  const signature = await sha1(toSign);

  const form = new FormData();
  // Data URI avoids Blob/filename quirks on some runtimes
  const dataUri =
    'data:application/json;base64,' +
    btoa(unescape(encodeURIComponent(content)));
  form.append('file', dataUri);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('public_id', publicId);
  form.append('signature', signature);
  form.append('overwrite', 'true');
  form.append('invalidate', 'true');

  const uploadRes = await fetch(
    'https://api.cloudinary.com/v1_1/' + cloudName + '/raw/upload',
    { method: 'POST', body: form }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error('Cloudinary upload failed: ' + errText);
  }
  return await uploadRes.json();
}

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}

async function sha1(message) {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash))
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}
