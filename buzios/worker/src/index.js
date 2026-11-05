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
    if (!payload.email) return json({ error: 'Email required' }, 400);
    store.submissions = store.submissions || [];
    // Normalize attachments: accept string URLs (legacy) or {url,label,key}
    const rawAtt = payload.attachments || [];
    const attachments = rawAtt.map(a => {
      if (typeof a === 'string') return { url: a, label: 'Documento', key: 'doc' };
      return {
        url: a.url || '',
        label: a.label || 'Documento',
        key: a.key || 'doc',
        name: a.name || ''
      };
    }).filter(a => a.url);
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
      goals: payload.goals || '',
      medicalConditions: payload.medicalConditions || '',
      schedule: payload.schedule || [],
      notes: payload.notes || '',
      docsLater: !!payload.docsLater,
      documents: payload.documents || {},
      paymentProof: payload.paymentProof || null,
      attachments,
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
        notes: [payload.notes, payload.goals ? 'Objectivos: ' + payload.goals : '', payload.medicalConditions ? 'Médicas: ' + payload.medicalConditions : ''].filter(Boolean).join('\n'),
        emergencyName: payload.emergencyName || '',
        emergencyPhone: payload.emergencyPhone || '',
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
  if (store.clients && store.clients.length > 3000) store.clients = store.clients.slice(0, 3000);

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

  // Debug: compare cache vs Cloudinary + raw fetch probes (no write)
  if (action === 'debug_store') {
    const fromCache = await loadStoreFromCache();
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
    const publicId = FOLDER + '/store.json';
    const probes = [];

    const probe = async (label, url, init) => {
      try {
        const res = await fetch(url, init || {});
        const text = await res.text();
        let clients = null;
        let updatedAt = null;
        let parseErr = null;
        try {
          const j = JSON.parse(text);
          clients = Array.isArray(j.clients) ? j.clients.length : null;
          updatedAt = j.updatedAt || null;
        } catch (e) {
          parseErr = (e && e.message) || 'parse error';
        }
        probes.push({
          label,
          status: res.status,
          bytes: text.length,
          clients,
          updatedAt,
          parseErr,
          head: text.slice(0, 80)
        });
      } catch (e) {
        probes.push({ label, error: (e && e.message) || String(e) });
      }
    };

    if (cloudName) {
      await probe(
        'delivery',
        'https://res.cloudinary.com/' + cloudName + '/raw/upload/' + publicId + '?_=' + Date.now()
      );
      if (apiKey && apiSecret) {
        const auth = btoa(apiKey + ':' + apiSecret);
        await probe(
          'admin_meta',
          'https://api.cloudinary.com/v1_1/' + cloudName + '/resources/raw/upload/' + encodeURIComponent(publicId),
          { headers: { Authorization: 'Basic ' + auth } }
        );
      }
    }

    const fromCloud = await loadStoreFromCloudinary(env);
    return json({
      ok: true,
      codeVersion: 'cloud-load-debug-v2',
      secrets: {
        cloudName: cloudName || null,
        hasKey: !!apiKey,
        hasSecret: !!apiSecret,
        keyLen: apiKey.length,
        secretLen: apiSecret.length
      },
      probes,
      cloudLoadDebug: _cloudLoadDebug,
      cache: {
        clients: (fromCache && fromCache.clients) ? fromCache.clients.length : 0,
        updatedAt: fromCache && fromCache.updatedAt,
        score: storeScore(fromCache)
      },
      cloudinary: {
        clients: (fromCloud && fromCloud.clients) ? fromCloud.clients.length : 0,
        updatedAt: fromCloud && fromCloud.updatedAt,
        score: storeScore(fromCloud)
      },
      chosenClients: (store.clients || []).length,
      chosenUpdatedAt: store.updatedAt
    });
  }

  if (action === 'update_submission' && data && data.id) {
    // Re-load before write so concurrent edits on other devices are kept
    store = await loadStore(env);
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
    // Strip UI-only fields; never accept a full clients array from the client
    const clean = Object.assign({}, data);
    delete clean._daysLeft;
    delete clean._expiringSoon;
    delete clean._expired;
    // Re-load right before write to shrink multi-staff race (last-write still wins
    // on the same client, but concurrent edits to *other* clients are kept).
    store = await loadStore(env);
    store.clients = store.clients || [];
    const idx = store.clients.findIndex(c => c.id === data.id);
    if (idx >= 0) {
      store.clients[idx] = Object.assign({}, store.clients[idx], clean, { id: data.id });
    } else {
      store.clients.unshift(Object.assign({}, clean, { id: data.id }));
    }
    if (store.clients.length > 3000) store.clients = store.clients.slice(0, 3000);
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'delete_client' && data && data.id) {
    store = await loadStore(env);
    store.clients = store.clients || [];
    const hard = !!data.hard;
    if (hard) {
      store.clients = store.clients.filter(c => c.id !== data.id);
    } else {
      // Soft delete → archive (keeps history)
      const idx = store.clients.findIndex(c => c.id === data.id);
      if (idx >= 0) {
        store.clients[idx] = Object.assign({}, store.clients[idx], {
          membershipStatus: 'arquivado',
          archivedAt: new Date().toISOString()
        });
      }
    }
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'delete_submission' && data && data.id) {
    store = await loadStore(env);
    store.submissions = (store.submissions || []).filter(s => s.id !== data.id);
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  if (action === 'delete_newsletter' && data && data.id) {
    store = await loadStore(env);
    store.newsletters = (store.newsletters || []).filter(n => n.id !== data.id);
    store.updatedAt = new Date().toISOString();
    await saveStore(env, store);
    return json({ ok: true, store });
  }

  // replace_store only merges non-empty sections — never wipe clients/submissions with []
  if (action === 'replace_store' && data && typeof data === 'object') {
    const next = Object.assign({}, store);
    if (Array.isArray(data.submissions) && data.submissions.length) next.submissions = data.submissions;
    if (Array.isArray(data.clients) && data.clients.length) next.clients = data.clients;
    if (Array.isArray(data.newsletters) && data.newsletters.length) next.newsletters = data.newsletters;
    if (Array.isArray(data.classes)) next.classes = data.classes;
    // Allow explicit full replace only when flag set (recovery tools)
    if (data._forceReplace === true) {
      next.submissions = data.submissions || [];
      next.clients = data.clients || [];
      next.newsletters = data.newsletters || [];
      next.classes = data.classes || [];
    }
    next.updatedAt = new Date().toISOString();
    store = next;
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

/**
 * Prefer newer updatedAt first (multi-device correctness).
 * Only use richness (score) as a tie-breaker when timestamps match/missing.
 * Never prefer empty over real data.
 */
function preferStore(a, b) {
  if (!a || isEmptyStore(a)) return b && !isEmptyStore(b) ? b : (b || a || emptyStore());
  if (!b || isEmptyStore(b)) return a;
  const ta = Date.parse(a.updatedAt || 0) || 0;
  const tb = Date.parse(b.updatedAt || 0) || 0;
  if (ta !== tb) return ta > tb ? a : b;
  const sa = storeScore(a);
  const sb = storeScore(b);
  return sa >= sb ? a : b;
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
  const bust =
    (url.includes('?') ? '&' : '?') +
    '_=' +
    Date.now() +
    '&cb=' +
    Math.random().toString(36).slice(2, 8);
  try {
    const res = await fetch(url + bust, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 2) return null;
    const data = JSON.parse(text);
    return looksLikeStore(data) ? data : null;
  } catch (_) {
    return null;
  }
}

// Last loadStoreFromCloudinary trace (read by debug_store)
let _cloudLoadDebug = null;

async function loadStoreFromCloudinary(env) {
  _cloudLoadDebug = { step: 'start' };
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName) {
    _cloudLoadDebug = { step: 'no_cloud_name' };
    return null;
  }

  const publicId = FOLDER + '/store.json';

  // Prefer Admin API versioned URL (bypasses CDN 30-day raw cache)
  if (apiKey && apiSecret) {
    try {
      const auth = btoa(apiKey + ':' + apiSecret);
      const metaRes = await fetch(
        'https://api.cloudinary.com/v1_1/' +
          cloudName +
          '/resources/raw/upload/' +
          encodeURIComponent(publicId),
        { headers: { Authorization: 'Basic ' + auth } }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const version = meta.version;
        if (version) {
          const versioned =
            'https://res.cloudinary.com/' +
            cloudName +
            '/raw/upload/v' +
            version +
            '/' +
            publicId;
          _cloudLoadDebug = { step: 'admin_versioned', version: version };
          const fileRes = await fetch(versioned, { cache: 'no-store' });
          if (fileRes.ok) {
            const text = await fileRes.text();
            const data = JSON.parse(text);
            if (looksLikeStore(data)) {
              _cloudLoadDebug.step = 'ok_admin';
              _cloudLoadDebug.updatedAt = data.updatedAt;
              _cloudLoadDebug.clientLen = Array.isArray(data.clients) ? data.clients.length : null;
              return data;
            }
          }
        }
      } else {
        _cloudLoadDebug = { step: 'admin_meta_fail', status: metaRes.status };
      }
    } catch (e) {
      _cloudLoadDebug = {
        step: 'admin_exception',
        error: (e && e.message) || String(e)
      };
    }
  }

  // Fallback: delivery URL with cache-bust (may still be CDN-stale)
  const url =
    'https://res.cloudinary.com/' +
    cloudName +
    '/raw/upload/' +
    publicId +
    '?_=' +
    Date.now() +
    '&cb=' +
    Math.random().toString(36).slice(2, 8);

  _cloudLoadDebug = Object.assign({}, _cloudLoadDebug || {}, {
    step: 'delivery_fetch',
    url: url.slice(0, 120)
  });

  try {
    const res = await fetch(url, { cache: 'no-store' });
    _cloudLoadDebug.status = res.status;
    _cloudLoadDebug.ok = res.ok;
    if (!res.ok) return null;

    const text = await res.text();
    _cloudLoadDebug.bytes = text ? text.length : 0;
    if (!text || text.length < 2) {
      _cloudLoadDebug.step = 'empty_body';
      return null;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      _cloudLoadDebug.step = 'json_parse_fail';
      _cloudLoadDebug.parseErr = (e && e.message) || String(e);
      return null;
    }

    if (!looksLikeStore(data)) {
      _cloudLoadDebug.step = 'looksLikeStore_false';
      return null;
    }

    _cloudLoadDebug.step = 'ok_delivery';
    _cloudLoadDebug.updatedAt = data.updatedAt;
    _cloudLoadDebug.clientLen = Array.isArray(data.clients) ? data.clients.length : null;
    return data;
  } catch (e) {
    _cloudLoadDebug = {
      step: 'exception',
      error: (e && e.message) || String(e)
    };
    return null;
  }
}

/**
 * Load store: Cloudinary is source of truth; Workers Cache is a fast path only
 * when it is at least as rich/new. Stale colo caches can no longer hide a
 * successful Cloudinary write from other regions.
 */
async function loadStore(env) {
  const fromCloud = await loadStoreFromCloudinary(env);
  const fromCache = await loadStoreFromCache();
  const chosen = preferStore(fromCloud, fromCache);

  // Always refresh this colo's cache when Cloudinary (or the winner) is richer
  if (!isEmptyStore(chosen)) {
    const cacheScore = storeScore(fromCache || emptyStore());
    if (isEmptyStore(fromCache) || storeScore(chosen) > cacheScore) {
      await putStoreCache(chosen);
    } else if (fromCloud && storeScore(fromCloud) >= cacheScore) {
      // Cloud matched cache — still write through so max-age stays fresh
      await putStoreCache(chosen);
    }
  }

  return chosen || emptyStore();
}

async function saveStore(env, store) {
  const body = JSON.stringify(store);
  // 1. Cloudinary first — durable + CDN invalidate (source of truth)
  await uploadRaw(env, FOLDER + '/store.json', body);
  // 2. Workers Cache — immediate read for this colo
  await putStoreCache(store);
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
