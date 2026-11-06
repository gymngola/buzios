/**
 * Búzios Publish + Submissions Worker
 *
 * Routes:
 *   POST /publish          — admin: publish catalog (password)
 *   POST /submit           — public: enrollment / contact / newsletter
 *   POST /admin/data       — admin: get or update submissions + clients (password)
 *
 * Cron (wrangler.toml [triggers]):
 *   0 3 1,7,13,19,25 * *  — every ~6 days at 03:00 UTC → d1BackupToCloudinary
 *
 * Secrets:
 *   ADMIN_PASSWORD
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Bindings:
 *   DB  — D1 database (buzios-db) for clients / submissions / newsletter
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FOLDER = 'buzios';

/**
 * Cutover flag (2026-11-06).
 * false = operational data (clients, submissions, newsletters) is D1-only.
 *         Mutations skip Cloudinary store.json writes.
 * true  = dual-write Cloudinary + D1 (legacy / rollback).
 * Catalog stays on Cloudinary either way. Use action d1_backup to export D1 → Cloudinary.
 */
const WRITE_OPS_TO_STORE = false;

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
  },

  /**
   * Cron: every ~6 days (see wrangler.toml [triggers]).
   * Exports D1 → Cloudinary dated snapshot + latest pointers.
   * Complements D1 Time Travel (7 days Free / 30 days Paid).
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      d1BackupToCloudinary(env, { source: 'cron', cron: event.cron || null }).then(
        (result) => {
          if (result && result.ok) {
            console.log(
              'cron d1_backup ok',
              result.exportedAt,
              'clients=' + result.clients,
              'files=' + (result.files || []).join(',')
            );
          } else {
            console.error('cron d1_backup failed', result && result.error);
          }
        },
        (err) => {
          console.error('cron d1_backup threw', err && err.message);
        }
      )
    );
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
  let newSubmission = null;
  let newClient = null;
  let newNewsletter = null;

  if (type === 'newsletter') {
    if (!payload.phone) return json({ error: 'Phone required' }, 400);
    store.newsletters = store.newsletters || [];
    if (!store.newsletters.some(n => n.phone === payload.phone)) {
      newNewsletter = {
        id,
        phone: String(payload.phone).trim(),
        createdAt: payload.createdAt || new Date().toISOString()
      };
      store.newsletters.unshift(newNewsletter);
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
    newSubmission = {
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
    };
    store.submissions.unshift(newSubmission);
    store.clients = store.clients || [];
    if (!store.clients.some(c => c.phone === payload.phone)) {
      newClient = {
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
      };
      store.clients.unshift(newClient);
    }
  } else {
    if (!payload.name && !payload.phone) return json({ error: 'Name or phone required' }, 400);
    store.submissions = store.submissions || [];
    newSubmission = {
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
    };
    store.submissions.unshift(newSubmission);
  }

  if (store.submissions && store.submissions.length > 500) store.submissions = store.submissions.slice(0, 500);
  if (store.newsletters && store.newsletters.length > 1000) store.newsletters = store.newsletters.slice(0, 1000);
  if (store.clients && store.clients.length > 3000) store.clients = store.clients.slice(0, 3000);

  store.updatedAt = new Date().toISOString();

  // D1 is primary for operational data after cutover.
  // Fail loud: never return ok when the primary write did not succeed.
  const mustWrite = !!(newSubmission || newClient || newNewsletter);
  if (mustWrite) {
    if (!env.DB) {
      console.error('D1 not bound on /submit — refusing silent success');
      return json(
        {
          error: 'Serviço temporariamente indisponível. Tente novamente em alguns minutos.',
          code: 'd1_unbound'
        },
        503
      );
    }
    try {
      if (newSubmission) await d1UpsertSubmission(env, newSubmission);
      if (newClient) await d1UpsertClient(env, newClient);
      if (newNewsletter) await d1UpsertNewsletter(env, newNewsletter);
    } catch (e) {
      console.error('D1 write on submit failed', e && e.message);
      return json(
        {
          error: 'Não foi possível guardar o pedido. Tente novamente.',
          code: 'd1_write_failed',
          detail: (e && e.message) || String(e)
        },
        500
      );
    }
  }

  if (WRITE_OPS_TO_STORE) {
    try {
      await saveStore(env, store);
    } catch (e) {
      // Dual-write path only; D1 already succeeded when mustWrite
      console.error('Cloudinary store write on submit failed', e && e.message);
    }
  }

  return json({ ok: true, id });
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
    const saved = Object.assign({}, data, { id: data.id });
    if (env.DB) {
      try {
        await d1UpsertSubmission(env, saved);
      } catch (e) {
        console.error('D1 upsert submission failed', e && e.message);
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    if (WRITE_OPS_TO_STORE) {
      store = await loadStore(env);
      store.submissions = store.submissions || [];
      const idx = store.submissions.findIndex(s => s.id === data.id);
      if (idx >= 0) {
        store.submissions[idx] = Object.assign({}, store.submissions[idx], saved);
      } else {
        store.submissions.unshift(saved);
      }
      store.updatedAt = new Date().toISOString();
      await saveStore(env, store);
      return json({ ok: true, store });
    }
    return json({ ok: true, submission: saved });
  }

  if (action === 'update_client' && data && data.id) {
    // Strip UI-only fields; never accept a full clients array from the client
    const clean = Object.assign({}, data);
    delete clean._daysLeft;
    delete clean._expiringSoon;
    delete clean._expired;
    const clientId = String(data.id);
    const saved = Object.assign({}, clean, { id: clientId });
    if (env.DB) {
      try {
        await d1UpsertClient(env, saved);
      } catch (e) {
        console.error('D1 upsert client failed', e && e.message);
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    if (WRITE_OPS_TO_STORE) {
      store = await loadStore(env);
      store.clients = store.clients || [];
      const idx = store.clients.findIndex(c => String(c.id) === clientId);
      if (idx >= 0) {
        store.clients[idx] = Object.assign({}, store.clients[idx], saved);
      } else {
        store.clients.unshift(saved);
      }
      if (store.clients.length > 3000) store.clients = store.clients.slice(0, 3000);
      store.updatedAt = new Date().toISOString();
      await saveStore(env, store);
      return json({ ok: true, store });
    }
    return json({ ok: true, client: saved });
  }

  if (action === 'delete_client' && data && data.id) {
    const clientId = String(data.id);
    const hard = !!data.hard;
    if (env.DB) {
      try {
        if (hard) {
          await d1HardDeleteClient(env, clientId);
        } else {
          // Soft archive: only touch status columns (admin often sends {id} only)
          await d1ArchiveClient(env, clientId);
        }
      } catch (e) {
        console.error('D1 delete/archive client failed', e && e.message);
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    if (WRITE_OPS_TO_STORE) {
      store = await loadStore(env);
      store.clients = store.clients || [];
      if (hard) {
        store.clients = store.clients.filter(c => String(c.id) !== clientId);
      } else {
        const idx = store.clients.findIndex(c => String(c.id) === clientId);
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
    return json({ ok: true });
  }

  if (action === 'delete_submission' && data && data.id) {
    if (env.DB) {
      try {
        await d1DeleteSubmission(env, data.id);
      } catch (e) {
        console.error('D1 delete submission failed', e && e.message);
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    if (WRITE_OPS_TO_STORE) {
      store = await loadStore(env);
      store.submissions = (store.submissions || []).filter(s => s.id !== data.id);
      store.updatedAt = new Date().toISOString();
      await saveStore(env, store);
      return json({ ok: true, store });
    }
    return json({ ok: true });
  }

  if (action === 'delete_newsletter' && data && data.id) {
    if (env.DB) {
      try {
        await d1DeleteNewsletter(env, data.id);
      } catch (e) {
        console.error('D1 delete newsletter failed', e && e.message);
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    if (WRITE_OPS_TO_STORE) {
      store = await loadStore(env);
      store.newsletters = (store.newsletters || []).filter(n => n.id !== data.id);
      store.updatedAt = new Date().toISOString();
      await saveStore(env, store);
      return json({ ok: true, store });
    }
    return json({ ok: true });
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

  // —— Auth (password already validated above) ——
  if (action === 'auth') {
    return json({ ok: true });
  }

  // —— D1 setup / migration / backup ——
  if (action === 'd1_status') {
    return json(await d1Status(env));
  }
  if (action === 'd1_import_from_store') {
    return json(await d1ImportFromStore(env, store));
  }
  if (action === 'd1_get_clients') {
    if (!env.DB) return json({ error: 'D1 not bound. Set database_id in wrangler.toml and redeploy.' }, 500);
    const clients = await d1ListClients(env);
    return json({ ok: true, clients, count: clients.length });
  }
  if (action === 'd1_get_submissions') {
    if (!env.DB) return json({ error: 'D1 not bound. Set database_id in wrangler.toml and redeploy.' }, 500);
    const submissions = await d1ListSubmissions(env);
    return json({ ok: true, submissions, count: submissions.length });
  }
  if (action === 'd1_get_newsletters') {
    if (!env.DB) return json({ error: 'D1 not bound. Set database_id in wrangler.toml and redeploy.' }, 500);
    const newsletters = await d1ListNewsletters(env);
    return json({ ok: true, newsletters, count: newsletters.length });
  }
  if (action === 'd1_backup') {
    return json(await d1BackupToCloudinary(env, { source: 'manual' }));
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
  // NOTE: Cloudflare Workers does NOT support fetch cache option
  // (`cache: 'no-store'` throws). Always bust with query params only.
  const bust =
    (url.includes('?') ? '&' : '?') +
    '_=' +
    Date.now() +
    '&cb=' +
    Math.random().toString(36).slice(2, 8);
  try {
    const res = await fetch(url + bust);
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
          // No { cache: 'no-store' } — Workers runtime throws on that option
          const fileRes = await fetch(versioned);
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
    // No { cache: 'no-store' } — Workers runtime throws on that option
    const res = await fetch(url);
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
  // Safety: never overwrite a real store with an empty one
  const incomingScore = storeScore(store);
  if (incomingScore <= 0) {
    const existing = await loadStoreFromCloudinary(env);
    if (existing && storeScore(existing) > 0) {
      throw new Error(
        'Refused to save empty store over existing data (' +
          storeScore(existing) +
          ' records).'
      );
    }
  }

  // Keep previous good snapshot for recovery
  try {
    const prev = await loadStoreFromCloudinary(env);
    if (prev && storeScore(prev) > 0) {
      await uploadRaw(env, FOLDER + '/store-prev.json', JSON.stringify(prev));
    }
  } catch (_) {
    // Backup failure must not block the main write
  }

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

// ═══════════════════════════════════════════════════════════
// D1 — clients / submissions / newsletter (primary after cutover)
// WRITE_OPS_TO_STORE=false → mutations skip store.json.
// d1_backup exports D1 → Cloudinary (d1-backup.json + optional store.json snapshot).
// ═══════════════════════════════════════════════════════════

async function d1Status(env) {
  if (!env.DB) {
    return {
      ok: false,
      bound: false,
      error: 'D1 not bound. Create DB, set database_id in wrangler.toml, redeploy.'
    };
  }
  try {
    const clients = await env.DB.prepare('SELECT COUNT(*) AS n FROM clients').first();
    const submissions = await env.DB.prepare('SELECT COUNT(*) AS n FROM submissions').first();
    const newsletters = await env.DB.prepare('SELECT COUNT(*) AS n FROM newsletters').first();
    return {
      ok: true,
      bound: true,
      clients: (clients && clients.n) || 0,
      submissions: (submissions && submissions.n) || 0,
      newsletters: (newsletters && newsletters.n) || 0
    };
  } catch (e) {
    return {
      ok: false,
      bound: true,
      error: (e && e.message) || String(e),
      hint: 'Run: npx wrangler d1 migrations apply buzios-db --remote'
    };
  }
}

function clientToRow(c) {
  const now = new Date().toISOString();
  return {
    id: String(c.id),
    member_number: c.memberNumber != null ? Number(c.memberNumber) : null,
    name: c.name || '',
    phone: c.phone || null,
    email: c.email || null,
    area: c.area || null,
    age: c.age != null && c.age !== '' ? Number(c.age) : null,
    schedule: c.schedule != null ? (typeof c.schedule === 'string' ? c.schedule : JSON.stringify(c.schedule)) : null,
    has_card: c.hasCard != null ? String(c.hasCard) : null,
    plan_id: c.planId || null,
    plan_name: c.planName || null,
    price: c.price != null && c.price !== '' ? Number(c.price) : null,
    billing_cycle: c.billingCycle || null,
    plan_start: c.planStart || null,
    plan_end: c.planEnd || null,
    membership_status: c.membershipStatus || null,
    billing_status: c.billingStatus || null,
    last_payment_at: c.lastPaymentAt || null,
    payments_json: c.payments ? JSON.stringify(c.payments) : null,
    notes: c.notes || null,
    emergency_name: c.emergencyName || null,
    emergency_phone: c.emergencyPhone || null,
    from_import: c.fromImport ? 1 : 0,
    from_submission: c.fromSubmission || null,
    created_at: c.createdAt || now,
    updated_at: now
  };
}

function rowToClient(r) {
  if (!r) return null;
  let payments = [];
  try {
    payments = r.payments_json ? JSON.parse(r.payments_json) : [];
  } catch (_) {}
  let schedule = r.schedule;
  try {
    if (schedule && schedule.charAt(0) === '[') schedule = JSON.parse(schedule);
  } catch (_) {}
  return {
    id: r.id,
    memberNumber: r.member_number,
    name: r.name,
    phone: r.phone,
    email: r.email,
    area: r.area,
    age: r.age,
    schedule: schedule,
    hasCard: r.has_card,
    planId: r.plan_id,
    planName: r.plan_name,
    price: r.price,
    billingCycle: r.billing_cycle,
    planStart: r.plan_start,
    planEnd: r.plan_end,
    membershipStatus: r.membership_status,
    billingStatus: r.billing_status,
    lastPaymentAt: r.last_payment_at,
    payments: payments,
    notes: r.notes,
    emergencyName: r.emergency_name,
    emergencyPhone: r.emergency_phone,
    fromImport: !!r.from_import,
    fromSubmission: r.from_submission,
    createdAt: r.created_at
  };
}

async function d1ListClients(env) {
  const res = await env.DB.prepare('SELECT * FROM clients ORDER BY member_number IS NULL, member_number, name').all();
  return (res.results || []).map(rowToClient);
}

function rowToSubmission(r) {
  if (!r) return null;
  let base = {};
  try {
    base = r.payload_json ? JSON.parse(r.payload_json) : {};
  } catch (_) {}
  // Columns are source of truth for indexed fields; payload_json keeps extras (attachments, schedule, goals, …)
  return Object.assign({}, base, {
    id: r.id,
    type: r.type != null ? r.type : base.type || null,
    status: r.status != null ? r.status : base.status || null,
    area: r.area != null ? r.area : base.area,
    planId: r.plan_id != null ? r.plan_id : base.planId,
    planName: r.plan_name != null ? r.plan_name : base.planName,
    name: r.name != null ? r.name : base.name,
    phone: r.phone != null ? r.phone : base.phone,
    email: r.email != null ? r.email : base.email,
    message: r.message != null ? r.message : base.message,
    subject: r.subject != null ? r.subject : base.subject,
    preferContact: r.prefer_contact != null ? r.prefer_contact : base.preferContact,
    fromClientId: r.from_client_id != null ? r.from_client_id : base.fromClientId,
    createdAt: r.created_at || base.createdAt,
    updatedAt: r.updated_at || base.updatedAt
  });
}

async function d1ListSubmissions(env) {
  const res = await env.DB.prepare(
    'SELECT * FROM submissions ORDER BY created_at DESC'
  ).all();
  return (res.results || []).map(rowToSubmission);
}

function rowToNewsletter(r) {
  if (!r) return null;
  return {
    id: r.id,
    phone: r.phone || null,
    name: r.name || null,
    createdAt: r.created_at || null
  };
}

async function d1ListNewsletters(env) {
  const res = await env.DB.prepare(
    'SELECT * FROM newsletters ORDER BY created_at DESC'
  ).all();
  return (res.results || []).map(rowToNewsletter);
}

async function d1UpsertClient(env, c) {
  const r = clientToRow(c);
  await env.DB.prepare(
    `INSERT INTO clients (
      id, member_number, name, phone, email, area, age, schedule, has_card,
      plan_id, plan_name, price, billing_cycle, plan_start, plan_end,
      membership_status, billing_status, last_payment_at, payments_json, notes,
      emergency_name, emergency_phone, from_import, from_submission, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      member_number=excluded.member_number,
      name=excluded.name,
      phone=excluded.phone,
      email=excluded.email,
      area=excluded.area,
      age=excluded.age,
      schedule=excluded.schedule,
      has_card=excluded.has_card,
      plan_id=excluded.plan_id,
      plan_name=excluded.plan_name,
      price=excluded.price,
      billing_cycle=excluded.billing_cycle,
      plan_start=excluded.plan_start,
      plan_end=excluded.plan_end,
      membership_status=excluded.membership_status,
      billing_status=excluded.billing_status,
      last_payment_at=excluded.last_payment_at,
      payments_json=excluded.payments_json,
      notes=excluded.notes,
      emergency_name=excluded.emergency_name,
      emergency_phone=excluded.emergency_phone,
      from_import=excluded.from_import,
      from_submission=excluded.from_submission,
      updated_at=excluded.updated_at`
  )
    .bind(
      r.id, r.member_number, r.name, r.phone, r.email, r.area, r.age, r.schedule, r.has_card,
      r.plan_id, r.plan_name, r.price, r.billing_cycle, r.plan_start, r.plan_end,
      r.membership_status, r.billing_status, r.last_payment_at, r.payments_json, r.notes,
      r.emergency_name, r.emergency_phone, r.from_import, r.from_submission, r.created_at, r.updated_at
    )
    .run();
}

async function d1HardDeleteClient(env, clientId) {
  await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(String(clientId)).run();
  await env.DB.prepare(
    'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(new Date().toISOString(), 'delete_client', 'client', String(clientId), 'hard')
    .run();
}

/** Soft-delete: only update membership_status (preserve other columns). */
async function d1ArchiveClient(env, clientId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE clients SET membership_status = 'arquivado', updated_at = ? WHERE id = ?`
  )
    .bind(now, String(clientId))
    .run();
  await env.DB.prepare(
    'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(now, 'archive_client', 'client', String(clientId), 'soft')
    .run();
}

async function d1UpsertSubmission(env, s) {
  const now = new Date().toISOString();
  const payload = JSON.stringify(s);
  await env.DB.prepare(
    `INSERT INTO submissions (
      id, type, status, area, plan_id, plan_name, name, phone, email, message, subject,
      prefer_contact, payload_json, from_client_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, status=excluded.status, area=excluded.area,
      plan_id=excluded.plan_id, plan_name=excluded.plan_name, name=excluded.name,
      phone=excluded.phone, email=excluded.email, message=excluded.message,
      subject=excluded.subject, prefer_contact=excluded.prefer_contact,
      payload_json=excluded.payload_json, from_client_id=excluded.from_client_id,
      updated_at=excluded.updated_at`
  )
    .bind(
      String(s.id),
      s.type || null,
      s.status || null,
      s.area || null,
      s.planId || null,
      s.planName || null,
      s.name || null,
      s.phone || null,
      s.email || null,
      s.message || null,
      s.subject || null,
      s.preferContact || null,
      payload,
      s.fromClientId || null,
      s.createdAt || now,
      now
    )
    .run();
}

async function d1DeleteSubmission(env, id) {
  await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(String(id)).run();
}

async function d1UpsertNewsletter(env, n) {
  const id = String(n.id || n.phone || ('nl-' + Date.now()));
  await env.DB.prepare(
    `INSERT INTO newsletters (id, phone, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET phone=excluded.phone, name=excluded.name`
  )
    .bind(id, n.phone || null, n.name || null, n.createdAt || new Date().toISOString())
    .run();
}

async function d1DeleteNewsletter(env, id) {
  await env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(String(id)).run();
}

async function d1ImportFromStore(env, store) {
  if (!env.DB) {
    return { ok: false, error: 'D1 not bound. Set database_id in wrangler.toml and redeploy.' };
  }

  const clients = store.clients || [];
  const submissions = store.submissions || [];
  const newsletters = store.newsletters || [];
  let clientCount = 0;
  let subCount = 0;
  let newsCount = 0;

  // Batch in chunks to stay under D1 limits
  const chunk = 50;
  for (let i = 0; i < clients.length; i += chunk) {
    const slice = clients.slice(i, i + chunk);
    for (const c of slice) {
      await d1UpsertClient(env, c);
      clientCount++;
    }
  }

  for (const s of submissions) {
    await d1UpsertSubmission(env, s);
    subCount++;
  }

  for (const n of newsletters) {
    await d1UpsertNewsletter(env, n);
    newsCount++;
  }

  await env.DB.prepare(
    'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      new Date().toISOString(),
      'd1_import_from_store',
      'store',
      null,
      JSON.stringify({ clients: clientCount, submissions: subCount, newsletters: newsCount })
    )
    .run();

  return {
    ok: true,
    clients: clientCount,
    submissions: subCount,
    newsletters: newsCount,
    message: 'Imported into D1. Cloudinary store unchanged.'
  };
}

/**
 * Export full D1 operational data to Cloudinary as backup.
 * Writes:
 *   - buzios/backups/d1-YYYY-MM-DD.json  (dated history; keep several)
 *   - buzios/d1-backup.json              (always-latest pointer)
 *   - buzios/store.json                  (emergency snapshot for rollback tooling)
 * opts.source: 'manual' | 'cron' (default manual)
 */
async function d1BackupToCloudinary(env, opts) {
  opts = opts || {};
  const source = opts.source || 'manual';
  if (!env.DB) {
    return { ok: false, error: 'D1 not bound. Set database_id in wrangler.toml and redeploy.' };
  }
  try {
    const clients = await d1ListClients(env);
    const submissions = await d1ListSubmissions(env);
    const newsletters = await d1ListNewsletters(env);
    const exportedAt = new Date().toISOString();
    const day = exportedAt.slice(0, 10); // YYYY-MM-DD
    const datedPublicId = FOLDER + '/backups/d1-' + day + '.json';
    const payload = {
      exportedAt,
      source: source,
      clients,
      submissions,
      newsletters,
      classes: []
    };
    const body = JSON.stringify(payload, null, 2);

    // 1. Dated history file (survives beyond Time Travel window)
    await uploadRaw(env, datedPublicId, body);
    // 2. Always-latest dedicated backup
    await uploadRaw(env, FOLDER + '/d1-backup.json', body);
    // 3. Refresh store.json so emergency rollback / old tooling still sees data
    await uploadRaw(
      env,
      FOLDER + '/store.json',
      JSON.stringify(
        {
          updatedAt: exportedAt,
          clients,
          submissions,
          newsletters,
          classes: []
        },
        null,
        2
      )
    );
    try {
      await putStoreCache({
        updatedAt: exportedAt,
        clients,
        submissions,
        newsletters,
        classes: []
      });
    } catch (_) {
      /* cache optional */
    }
    await env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(
        exportedAt,
        'd1_backup',
        'store',
        null,
        JSON.stringify({
          source: source,
          cron: opts.cron || null,
          clients: clients.length,
          submissions: submissions.length,
          newsletters: newsletters.length,
          dated: datedPublicId
        })
      )
      .run();
    return {
      ok: true,
      exportedAt,
      source: source,
      clients: clients.length,
      submissions: submissions.length,
      newsletters: newsletters.length,
      files: [datedPublicId, FOLDER + '/d1-backup.json', FOLDER + '/store.json']
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
