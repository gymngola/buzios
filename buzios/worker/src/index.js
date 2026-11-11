/**
 * Búzios Publish + Submissions Worker
 *
 * Routes:
 *   POST /publish          — admin: publish catalog (password)
 *   POST /submit           — public: enrollment / contact / newsletter
 *   POST /admin/data       — admin: get or update submissions + clients (password)
 *   POST /client/auth      — member portal: login / register / me / delete_account
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
      if (request.method === 'POST' && path === '/client/auth') {
        return await handleClientAuth(request, env);
      }
      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      return json({ error: err.message || 'Server error' }, 500);
    }
  },

  /**
   * Cron: every ~6 days (see wrangler.toml [triggers]).
   * 1) Export D1 → Cloudinary dated snapshot + latest pointers.
   * 2) Permanently purge trash older than 30 days.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const result = await d1BackupToCloudinary(env, {
          source: 'cron',
          cron: event.cron || null
        });
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
        try {
          const purge = await d1PurgeTrash(env, 30);
          console.log(
            'cron purge_trash',
            'clients=' + purge.clientsPurged,
            'submissions=' + purge.submissionsPurged
          );
        } catch (e) {
          console.error('cron purge_trash failed', e && e.message);
        }
      })()
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
      // Copy enrollment docs onto the auto-created client so they survive
      // status-only updates on the submission (which used to wipe payload_json).
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
        fromSubmission: id,
        attachments: attachments.length ? attachments : null,
        documents: payload.documents && typeof payload.documents === 'object' && Object.keys(payload.documents).length
          ? payload.documents
          : null,
        paymentProof: payload.paymentProof || null
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
  // Multi-row enrollment uses batch() (one transaction) + retries on transient errors.
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
      await d1BatchWithRetry(env, () => {
        const stmts = [];
        if (newSubmission) stmts.push(d1SubmissionUpsertStmt(env, newSubmission));
        if (newClient) stmts.push(d1ClientUpsertStmt(env, newClient));
        if (newNewsletter) stmts.push(d1NewsletterUpsertStmt(env, newNewsletter));
        return stmts;
      });
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
  const adminName = String((body && body.adminName) || (data && data.adminName) || '').trim().slice(0, 80);
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
    // Merge partial updates into the existing submission. Status-only (or
    // fromClientId-only) payloads must NOT replace payload_json — that was
    // wiping attachments, documents, lineItems, goals, etc.
    let saved = Object.assign({}, data, { id: data.id });
    if (env.DB) {
      try {
        const existing = await d1FindSubmissionById(env, data.id);
        if (existing) {
          saved = Object.assign({}, existing, data, { id: data.id });
          // Never let a partial update clear createdAt
          if (!saved.createdAt && existing.createdAt) saved.createdAt = existing.createdAt;
        }
        await d1UpsertSubmission(env, saved);
        await d1Audit(env, 'save_submission', 'submission', String(data.id), saved.name || saved.status || '', adminName);
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
        const detail = [saved.name, saved.plan_name || saved.planName, saved.membership_status || saved.membershipStatus]
          .filter(Boolean)
          .join(' · ');
        await d1Audit(env, 'save_client', 'client', clientId, detail, adminName);
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

  // hard=false → archive (arquivado). hard=true → trash (deleted_at, 30-day recovery).
  // data.purge=true → permanent DELETE (cron / empty trash only).
  if (action === 'delete_client' && data && data.id) {
    const clientId = String(data.id);
    const hard = !!data.hard;
    const purge = !!data.purge;
    if (env.DB) {
      try {
        if (purge) {
          await d1HardDeleteClient(env, clientId);
        } else if (hard) {
          await d1TrashClient(env, clientId);
        } else {
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
      if (purge) {
        store.clients = store.clients.filter(c => String(c.id) !== clientId);
      } else if (hard) {
        const idx = store.clients.findIndex(c => String(c.id) === clientId);
        if (idx >= 0) {
          store.clients[idx] = Object.assign({}, store.clients[idx], {
            deletedAt: new Date().toISOString()
          });
        }
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

  if (action === 'restore_client' && data && data.id) {
    if (env.DB) {
      try {
        await d1RestoreClient(env, data.id);
      } catch (e) {
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    return json({ ok: true });
  }

  // Soft-delete to trash (deleted_at). data.purge=true → permanent.
  if (action === 'delete_submission' && data && data.id) {
    const purge = !!data.purge;
    if (env.DB) {
      try {
        if (purge) {
          await d1HardDeleteSubmission(env, data.id);
        } else {
          await d1TrashSubmission(env, data.id);
        }
      } catch (e) {
        console.error('D1 delete submission failed', e && e.message);
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    if (WRITE_OPS_TO_STORE) {
      store = await loadStore(env);
      if (purge) {
        store.submissions = (store.submissions || []).filter(s => s.id !== data.id);
      } else {
        const idx = (store.submissions || []).findIndex(s => s.id === data.id);
        if (idx >= 0) {
          store.submissions[idx] = Object.assign({}, store.submissions[idx], {
            status: 'eliminado',
            deletedAt: new Date().toISOString()
          });
        }
      }
      store.updatedAt = new Date().toISOString();
      await saveStore(env, store);
      return json({ ok: true, store });
    }
    return json({ ok: true });
  }

  if (action === 'restore_submission' && data && data.id) {
    if (env.DB) {
      try {
        await d1RestoreSubmission(env, data.id);
      } catch (e) {
        return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
      }
    }
    return json({ ok: true });
  }

  if (action === 'd1_purge_trash') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    return json(await d1PurgeTrash(env, data && data.days != null ? Number(data.days) : 30));
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
    const authEpoch = await d1GetAuthEpoch(env);
    return json({ ok: true, authEpoch });
  }

  if (action === 'force_logout_all') {
    try {
      const authEpoch = await d1BumpAuthEpoch(env);
      // Clear presence so "online" resets immediately
      if (env.DB) {
        try {
          await d1EnsurePresenceTable(env);
          await env.DB.prepare('DELETE FROM admin_presence').run();
        } catch (e) { /* ignore */ }
      }
      await d1Audit(env, 'force_logout_all', 'admin', '', 'all sessions invalidated', adminName);
      return json({ ok: true, authEpoch, message: 'Todas as sessões foram invalidadas' });
    } catch (e) {
      return json({ error: 'force_logout failed: ' + (e && e.message) }, 500);
    }
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

  if (action === 'get_audit_log') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 200, 1), 500);
    const entityId = data && data.entityId ? String(data.entityId).slice(0, 80) : '';
    let results;
    if (entityId) {
      const q = await env.DB.prepare(
        `SELECT id, at, action, entity, entity_id, detail
         FROM audit_log
         WHERE entity_id = ?
         ORDER BY id DESC
         LIMIT ?`
      ).bind(entityId, limit).all();
      results = q.results || [];
    } else {
      const q = await env.DB.prepare(
        `SELECT id, at, action, entity, entity_id, detail
         FROM audit_log
         ORDER BY id DESC
         LIMIT ?`
      ).bind(limit).all();
      results = q.results || [];
    }
    return json({ ok: true, entries: results || [], count: (results || []).length });
  }

  if (action === 'get_client_history') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const clientId = String((data && data.clientId) || '').trim();
    if (!clientId) return json({ error: 'clientId required' }, 400);
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 200, 1), 500);
    try {
      await d1EnsureTrainingsTable(env);
      const trainingsQ = await env.DB.prepare(
        `SELECT id, client_id, trained_at, trained_date, recorded_by, note, created_at
         FROM trainings WHERE client_id = ?
         ORDER BY trained_at DESC LIMIT ?`
      ).bind(clientId, limit).all();
      const auditQ = await env.DB.prepare(
        `SELECT id, at, action, entity, entity_id, detail
         FROM audit_log
         WHERE entity_id = ? OR (entity = 'training' AND detail LIKE ?)
         ORDER BY id DESC LIMIT ?`
      ).bind(clientId, clientId + '%', limit).all();
      return json({
        ok: true,
        trainings: (trainingsQ.results || []).map(trainingRowFromDb),
        audit: auditQ.results || []
      });
    } catch (e) {
      console.error('get_client_history', e && e.message);
      return json({ error: 'D1 read failed: ' + (e && e.message) }, 500);
    }
  }

  // —— Trainings / attendance ——
  if (action === 'add_training') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const clientId = String((data && data.clientId) || '').trim();
    if (!clientId) return json({ error: 'clientId required' }, 400);
    try {
      const row = await d1AddTraining(env, {
        clientId,
        trainedAt: data && data.trainedAt,
        note: data && data.note,
        recordedBy: adminName || (data && data.recordedBy) || ''
      });
      await d1Audit(env, 'add_training', 'training', row.id, clientId + (row.note ? ' · ' + row.note : ''), adminName);
      return json({ ok: true, training: row });
    } catch (e) {
      console.error('add_training', e && e.message);
      return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
    }
  }

  if (action === 'delete_training') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const id = String((data && data.id) || '').trim();
    if (!id) return json({ error: 'id required' }, 400);
    try {
      await d1DeleteTraining(env, id);
      await d1Audit(env, 'delete_training', 'training', id, '', adminName);
      return json({ ok: true });
    } catch (e) {
      console.error('delete_training', e && e.message);
      return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
    }
  }

  if (action === 'update_training') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const id = String((data && data.id) || '').trim();
    if (!id) return json({ error: 'id required' }, 400);
    try {
      const row = await d1UpdateTraining(env, {
        id,
        trainedAt: data && data.trainedAt,
        note: data && data.note
      });
      if (!row) return json({ error: 'Sessão não encontrada' }, 404);
      await d1Audit(env, 'update_training', 'training', id, (row.note || '').slice(0, 120), adminName);
      return json({ ok: true, training: row });
    } catch (e) {
      console.error('update_training', e && e.message);
      return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
    }
  }

  if (action === 'list_trainings') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    try {
      const result = await d1ListTrainings(env, {
        clientId: data && data.clientId,
        date: data && data.date,
        month: data && data.month,
        limit: data && data.limit
      });
      return json({ ok: true, trainings: result.trainings, counts: result.counts });
    } catch (e) {
      console.error('list_trainings', e && e.message);
      return json({ error: 'D1 read failed: ' + (e && e.message) }, 500);
    }
  }

  if (action === 'trainings_summary') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    try {
      const date = String((data && data.date) || new Date().toISOString().slice(0, 10));
      const month = date.slice(0, 7);
      const summary = await d1TrainingsSummary(env, date, month);
      return json({ ok: true, date, month, ...summary });
    } catch (e) {
      console.error('trainings_summary', e && e.message);
      return json({ error: 'D1 read failed: ' + (e && e.message) }, 500);
    }
  }

  // Bulk import monthly training counts from legacy Excel (NUM. VEZES).
  // data.records: [{ memberNumber, year, month, count, name? }]
  // Creates `count` session rows spread across the month (approx. days for history).
  // Skips months already imported for that client (note marker). Idempotent-ish.
  if (action === 'import_trainings_bulk') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const records = (data && data.records) || [];
    if (!Array.isArray(records) || !records.length) {
      return json({ error: 'records[] required' }, 400);
    }
    try {
      const result = await d1ImportTrainingsBulk(env, records, adminName || '');
      await d1Audit(
        env,
        'import_trainings_bulk',
        'training',
        '',
        'imported=' + result.inserted + ' skipped=' + result.skipped + ' unmatched=' + result.unmatched,
        adminName
      );
      return json({ ok: true, ...result });
    } catch (e) {
      console.error('import_trainings_bulk', e && e.message);
      return json({ error: 'D1 write failed: ' + (e && e.message) }, 500);
    }
  }

  // —— Admin presence (open panels) ——
  if (action === 'presence_heartbeat') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    const sessionId = String((data && data.sessionId) || '').slice(0, 64);
    if (!sessionId) return json({ error: 'sessionId required' }, 400);
    const ua = String((data && data.userAgent) || '').slice(0, 180);
    const name = String((data && data.adminName) || adminName || '').trim().slice(0, 80);
    try {
      const result = await d1PresenceHeartbeat(env, sessionId, ua, name);
      const authEpoch = await d1GetAuthEpoch(env);
      return json({ ok: true, online: result.online, names: result.names, authEpoch });
    } catch (e) {
      console.error('presence_heartbeat', e && e.message);
      return json({ error: 'presence failed: ' + (e && e.message) }, 500);
    }
  }

  if (action === 'presence_leave') {
    if (!env.DB) return json({ ok: true, online: 0, names: [] });
    const sessionId = String((data && data.sessionId) || '').slice(0, 64);
    if (sessionId) {
      try {
        await env.DB.prepare('DELETE FROM admin_presence WHERE session_id = ?').bind(sessionId).run();
      } catch (e) { /* ignore */ }
    }
    try {
      const result = await d1PresenceList(env);
      return json({ ok: true, online: result.online, names: result.names });
    } catch (e) {
      return json({ ok: true, online: 0, names: [] });
    }
  }

  if (action === 'presence_get') {
    if (!env.DB) return json({ error: 'D1 not bound' }, 500);
    try {
      const result = await d1PresenceList(env);
      return json({ ok: true, online: result.online, names: result.names });
    } catch (e) {
      return json({ error: 'presence failed: ' + (e && e.message) }, 500);
    }
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
  // Persist attachments / documents / paymentProof in documents_json (migration 0003)
  let documents_json = null;
  try {
    const docsPayload = {
      attachments: Array.isArray(c.attachments) ? c.attachments : [],
      documents: c.documents && typeof c.documents === 'object' ? c.documents : null,
      paymentProof: c.paymentProof || null
    };
    if (
      (docsPayload.attachments && docsPayload.attachments.length) ||
      (docsPayload.documents && Object.keys(docsPayload.documents).length) ||
      docsPayload.paymentProof
    ) {
      documents_json = JSON.stringify(docsPayload);
    } else if (c.documents_json != null) {
      // Allow raw passthrough when already serialized
      documents_json = typeof c.documents_json === 'string' ? c.documents_json : JSON.stringify(c.documents_json);
    }
  } catch (_) {
    documents_json = null;
  }
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
    updated_at: now,
    photo_url: c.photoUrl || c.photo_url || null,
    documents_json
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
  // Restore attachments / documents / paymentProof from documents_json
  let attachments = null;
  let documents = null;
  let paymentProof = null;
  try {
    if (r.documents_json) {
      const parsed = typeof r.documents_json === 'string' ? JSON.parse(r.documents_json) : r.documents_json;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.attachments)) attachments = parsed.attachments;
        else if (Array.isArray(parsed)) attachments = parsed; // legacy: bare array
        if (parsed.documents && typeof parsed.documents === 'object') documents = parsed.documents;
        if (parsed.paymentProof) paymentProof = parsed.paymentProof;
      }
    }
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
    createdAt: r.created_at,
    deletedAt: r.deleted_at || null,
    photoUrl: r.photo_url || null,
    accountStatus: r.account_status || null,
    lastLoginAt: r.last_login_at || null,
    attachments: attachments,
    documents: documents,
    paymentProof: paymentProof
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
    updatedAt: r.updated_at || base.updatedAt,
    deletedAt: r.deleted_at || null
  });
}

async function d1ListSubmissions(env) {
  const res = await env.DB.prepare(
    'SELECT * FROM submissions ORDER BY created_at DESC'
  ).all();
  return (res.results || []).map(rowToSubmission);
}

/** Load one submission by id (full payload, including attachments). */
async function d1FindSubmissionById(env, id) {
  if (!id || !env.DB) return null;
  const res = await env.DB.prepare(
    'SELECT * FROM submissions WHERE id = ? LIMIT 1'
  )
    .bind(String(id))
    .first();
  return res ? rowToSubmission(res) : null;
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

// —— D1 retry + batch (writes are not auto-retried by the platform) ——

/** Transient D1 / DO errors that are safe to retry (per Cloudflare docs). */
function d1IsRetryableError(err) {
  const msg = String((err && err.message) || err || '');
  return (
    msg.includes('Network connection lost') ||
    msg.includes('storage caused object to be reset') ||
    msg.includes('reset because its code was updated') ||
    msg.includes('Cannot resolve D1 DB due to transient issue') ||
    msg.includes('D1 DB is overloaded') ||
    msg.includes('too many requests') ||
    /SQLITE_BUSY/i.test(msg)
  );
}

function d1Sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a statement factory with retries + exponential backoff + jitter.
 * buildStmts() must return a fresh array of bound statements each call
 * (D1 statements are single-use after bind for batch safety).
 */
async function d1BatchWithRetry(env, buildStmts, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const stmts = buildStmts() || [];
      if (!stmts.length) return;
      if (stmts.length === 1) {
        await stmts[0].run();
      } else {
        // batch() is one SQL transaction: all succeed or the sequence rolls back
        await env.DB.batch(stmts);
      }
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts && d1IsRetryableError(e)) {
        const backoff = 40 * attempt * attempt + Math.floor(Math.random() * 60);
        console.warn('D1 transient error, retry', attempt, (e && e.message) || e);
        await d1Sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function d1ClientUpsertStmt(env, c) {
  const r = clientToRow(c);
  // photo_url + documents_json require migration 0003_client_portal
  return env.DB.prepare(
    `INSERT INTO clients (
      id, member_number, name, phone, email, area, age, schedule, has_card,
      plan_id, plan_name, price, billing_cycle, plan_start, plan_end,
      membership_status, billing_status, last_payment_at, payments_json, notes,
      emergency_name, emergency_phone, from_import, from_submission, created_at, updated_at,
      photo_url, documents_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      updated_at=excluded.updated_at,
      photo_url=excluded.photo_url,
      documents_json=excluded.documents_json`
  ).bind(
    r.id, r.member_number, r.name, r.phone, r.email, r.area, r.age, r.schedule, r.has_card,
    r.plan_id, r.plan_name, r.price, r.billing_cycle, r.plan_start, r.plan_end,
    r.membership_status, r.billing_status, r.last_payment_at, r.payments_json, r.notes,
    r.emergency_name, r.emergency_phone, r.from_import, r.from_submission, r.created_at, r.updated_at,
    r.photo_url, r.documents_json
  );
}

async function d1UpsertClient(env, c) {
  await d1BatchWithRetry(env, () => [d1ClientUpsertStmt(env, c)]);
}

/** Append one row to audit_log (best-effort; never fails the parent write). */
async function d1Audit(env, action, entity, entityId, detail, actor) {
  if (!env.DB) return;
  try {
    const at = new Date().toISOString();
    const who = actor ? '[' + String(actor).slice(0, 60) + '] ' : '';
    const fullDetail = (who + String(detail || '')).slice(0, 400);
    await env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(at, String(action || ''), String(entity || ''), String(entityId || ''), fullDetail)
      .run();
  } catch (e) {
    console.error('audit_log insert failed', e && e.message);
  }
}

// —— Auth epoch (force remote logout) ——
async function d1EnsureSettingsTable(env) {
  if (!env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`
  ).run();
}

async function d1GetAuthEpoch(env) {
  if (!env.DB) return 1;
  try {
    await d1EnsureSettingsTable(env);
    const row = await env.DB.prepare(
      "SELECT value FROM admin_settings WHERE key = 'auth_epoch'"
    ).first();
    const n = row && row.value != null ? parseInt(row.value, 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch (e) {
    return 1;
  }
}

async function d1BumpAuthEpoch(env) {
  if (!env.DB) return 1;
  await d1EnsureSettingsTable(env);
  const current = await d1GetAuthEpoch(env);
  const next = current + 1;
  await env.DB.prepare(
    `INSERT INTO admin_settings (key, value) VALUES ('auth_epoch', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(String(next)).run();
  return next;
}

// —— Trainings helpers ——
async function d1EnsureTrainingsTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS trainings (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      trained_at TEXT NOT NULL,
      trained_date TEXT NOT NULL,
      recorded_by TEXT,
      note TEXT,
      created_at TEXT
    )`
  ).run();
  try {
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trainings_client ON trainings(client_id)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trainings_date ON trainings(trained_date)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trainings_client_date ON trainings(client_id, trained_date)').run();
  } catch (e) { /* ignore */ }
}

function trainingRowFromDb(r) {
  if (!r) return null;
  return {
    id: r.id,
    clientId: r.client_id,
    trainedAt: r.trained_at,
    trainedDate: r.trained_date,
    recordedBy: r.recorded_by || '',
    note: r.note || '',
    createdAt: r.created_at
  };
}

async function d1AddTraining(env, opts) {
  await d1EnsureTrainingsTable(env);
  const now = new Date();
  const trainedAt = opts.trainedAt ? new Date(opts.trainedAt) : now;
  const iso = isNaN(trainedAt.getTime()) ? now.toISOString() : trainedAt.toISOString();
  const trainedDate = iso.slice(0, 10);
  const id = 'tr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const createdAt = now.toISOString();
  const note = String(opts.note || '').slice(0, 200);
  const recordedBy = String(opts.recordedBy || '').slice(0, 80);
  await env.DB.prepare(
    `INSERT INTO trainings (id, client_id, trained_at, trained_date, recorded_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, String(opts.clientId), iso, trainedDate, recordedBy, note, createdAt)
    .run();
  return {
    id,
    clientId: String(opts.clientId),
    trainedAt: iso,
    trainedDate,
    recordedBy,
    note,
    createdAt
  };
}

/** Map member_number → client id for import matching. */
async function d1MemberNumberMap(env) {
  const res = await env.DB.prepare(
    `SELECT id, member_number FROM clients
     WHERE member_number IS NOT NULL
       AND (deleted_at IS NULL OR deleted_at = '')`
  ).all();
  const map = {};
  for (const r of res.results || []) {
    if (r.member_number == null) continue;
    map[String(r.member_number)] = r.id;
  }
  return map;
}

/**
 * Import monthly attendance totals from Excel-style records.
 * Each count>0 creates that many training rows spread across the month.
 * Note marker: "Importado Excel — YYYY-MM" (skip if already present for client/month).
 */
async function d1ImportTrainingsBulk(env, records, adminName) {
  await d1EnsureTrainingsTable(env);
  const memberMap = await d1MemberNumberMap(env);
  const recordedBy = String(adminName || 'Import Excel').slice(0, 80);
  const createdAt = new Date().toISOString();

  let inserted = 0;
  let skipped = 0;
  let unmatched = 0;
  const unmatchedSamples = [];
  const stmts = [];

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  for (const rec of records) {
    const memberNumber = rec.memberNumber != null ? String(rec.memberNumber) : '';
    const year = parseInt(rec.year, 10);
    const month = parseInt(rec.month, 10);
    let count = parseInt(rec.count, 10);
    if (!memberNumber || !year || !month || month < 1 || month > 12) {
      skipped++;
      continue;
    }
    if (!Number.isFinite(count) || count < 0) {
      skipped++;
      continue;
    }
    if (count === 0) {
      // S/P — no sessions
      skipped++;
      continue;
    }
    const clientId = memberMap[memberNumber];
    if (!clientId) {
      unmatched++;
      if (unmatchedSamples.length < 30) {
        unmatchedSamples.push({ memberNumber, name: rec.name || '', year, month, count });
      }
      continue;
    }

    const monthKey = year + '-' + String(month).padStart(2, '0');
    const noteMarker = 'Importado Excel — ' + monthKey;

    // Skip if this client already has imported sessions for this month
    const existing = await env.DB.prepare(
      `SELECT id FROM trainings
       WHERE client_id = ? AND trained_date >= ? AND trained_date < ?
         AND note LIKE ?
       LIMIT 1`
    )
      .bind(
        clientId,
        monthKey + '-01',
        month === 12 ? (year + 1) + '-01-01' : year + '-' + String(month + 1).padStart(2, '0') + '-01',
        noteMarker + '%'
      )
      .first();
    if (existing) {
      skipped++;
      continue;
    }

    const dim = daysInMonth(year, month);
    const n = Math.min(count, 60); // safety cap per month
    for (let i = 0; i < n; i++) {
      // Spread across the month; overflow stacks on last days
      const day = Math.min(dim, 1 + Math.floor((i * dim) / n));
      const dd = String(day).padStart(2, '0');
      const trainedDate = monthKey + '-' + dd;
      const hour = 8 + (i % 10);
      const trainedAt = trainedDate + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z';
      const id =
        'tr-imp-' +
        memberNumber +
        '-' +
        monthKey.replace('-', '') +
        '-' +
        String(i).padStart(2, '0') +
        '-' +
        Math.random().toString(36).slice(2, 6);
      const note = (noteMarker + ' (' + count + '×)').slice(0, 200);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO trainings (id, client_id, trained_at, trained_date, recorded_by, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, clientId, trainedAt, trainedDate, recordedBy, note, createdAt)
      );
      inserted++;
    }
  }

  // D1 batch in chunks of 50
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50);
    await env.DB.batch(chunk);
  }

  return { inserted, skipped, unmatched, unmatchedSamples };
}

async function d1DeleteTraining(env, id) {
  await d1EnsureTrainingsTable(env);
  await env.DB.prepare('DELETE FROM trainings WHERE id = ?').bind(String(id)).run();
}

async function d1UpdateTraining(env, opts) {
  await d1EnsureTrainingsTable(env);
  const id = String(opts.id || '').trim();
  if (!id) return null;
  const existing = await env.DB.prepare(
    'SELECT id, client_id, trained_at, trained_date, recorded_by, note, created_at FROM trainings WHERE id = ? LIMIT 1'
  )
    .bind(id)
    .first();
  if (!existing) return null;

  let trainedAt = existing.trained_at;
  let trainedDate = existing.trained_date;
  if (opts.trainedAt) {
    const d = new Date(opts.trainedAt);
    if (!isNaN(d.getTime())) {
      trainedAt = d.toISOString();
      trainedDate = trainedAt.slice(0, 10);
    }
  }
  const note =
    opts.note !== undefined && opts.note !== null
      ? String(opts.note).slice(0, 200)
      : existing.note || '';

  await env.DB.prepare(
    `UPDATE trainings SET trained_at = ?, trained_date = ?, note = ? WHERE id = ?`
  )
    .bind(trainedAt, trainedDate, note, id)
    .run();

  return {
    id: existing.id,
    clientId: existing.client_id,
    trainedAt,
    trainedDate,
    recordedBy: existing.recorded_by || '',
    note,
    createdAt: existing.created_at
  };
}

async function d1ListTrainings(env, opts) {
  await d1EnsureTrainingsTable(env);
  const limit = Math.min(Math.max(parseInt(opts && opts.limit, 10) || 100, 1), 500);
  const clientId = opts && opts.clientId ? String(opts.clientId) : '';
  const date = opts && opts.date ? String(opts.date).slice(0, 10) : '';
  const month = opts && opts.month ? String(opts.month).slice(0, 7) : '';

  let sql = 'SELECT id, client_id, trained_at, trained_date, recorded_by, note, created_at FROM trainings';
  const binds = [];
  const where = [];
  if (clientId) {
    where.push('client_id = ?');
    binds.push(clientId);
  }
  if (date) {
    where.push('trained_date = ?');
    binds.push(date);
  } else if (month) {
    where.push('trained_date >= ? AND trained_date < ?');
    binds.push(month + '-01');
    // next month
    const [y, m] = month.split('-').map(Number);
    const nm = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    binds.push(nm);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY trained_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  const trainings = (results || []).map(trainingRowFromDb);

  // Optional per-client counts for the same filter window
  let counts = null;
  if (!clientId && (date || month)) {
    let csql = 'SELECT client_id, COUNT(*) AS n FROM trainings';
    const cbinds = [];
    const cwhere = [];
    if (date) {
      cwhere.push('trained_date = ?');
      cbinds.push(date);
    } else if (month) {
      cwhere.push('trained_date >= ? AND trained_date < ?');
      cbinds.push(month + '-01');
      const [y, m] = month.split('-').map(Number);
      const nm = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
      cbinds.push(nm);
    }
    if (cwhere.length) csql += ' WHERE ' + cwhere.join(' AND ');
    csql += ' GROUP BY client_id';
    const cres = await env.DB.prepare(csql).bind(...cbinds).all();
    counts = {};
    for (const r of cres.results || []) {
      counts[r.client_id] = Number(r.n) || 0;
    }
  }

  return { trainings, counts };
}

async function d1TrainingsSummary(env, date, month) {
  await d1EnsureTrainingsTable(env);
  const dayRes = await env.DB.prepare(
    'SELECT client_id, COUNT(*) AS n FROM trainings WHERE trained_date = ? GROUP BY client_id'
  ).bind(date).all();
  const [y, m] = month.split('-').map(Number);
  const nm = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
  const monthRes = await env.DB.prepare(
    'SELECT client_id, COUNT(*) AS n FROM trainings WHERE trained_date >= ? AND trained_date < ? GROUP BY client_id'
  ).bind(month + '-01', nm).all();

  const todayByClient = {};
  let todayTotal = 0;
  for (const r of dayRes.results || []) {
    const n = Number(r.n) || 0;
    todayByClient[r.client_id] = n;
    todayTotal += n;
  }
  const monthByClient = {};
  let monthTotal = 0;
  for (const r of monthRes.results || []) {
    const n = Number(r.n) || 0;
    monthByClient[r.client_id] = n;
    monthTotal += n;
  }

  // Recent sessions for the day (for the Treinos list detail)
  const { results: daySessions } = await env.DB.prepare(
    `SELECT id, client_id, trained_at, trained_date, recorded_by, note, created_at
     FROM trainings WHERE trained_date = ? ORDER BY trained_at DESC LIMIT 300`
  ).bind(date).all();

  return {
    todayByClient,
    monthByClient,
    todayTotal,
    monthTotal,
    daySessions: (daySessions || []).map(trainingRowFromDb)
  };
}

/** Sessions with last_seen within this window count as online. */
const PRESENCE_ONLINE_MS = 2 * 60 * 1000;

async function d1EnsurePresenceTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS admin_presence (
      session_id TEXT PRIMARY KEY,
      last_seen TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT,
      admin_name TEXT
    )`
  ).run();
  // Best-effort add column for existing deployments
  try {
    await env.DB.prepare('ALTER TABLE admin_presence ADD COLUMN admin_name TEXT').run();
  } catch (e) { /* already exists */ }
}

async function d1PresenceHeartbeat(env, sessionId, userAgent, adminName) {
  await d1EnsurePresenceTable(env);
  const now = new Date().toISOString();
  const name = String(adminName || '').slice(0, 80);
  await env.DB.prepare(
    `INSERT INTO admin_presence (session_id, last_seen, user_agent, created_at, admin_name)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       last_seen = excluded.last_seen,
       user_agent = excluded.user_agent,
       admin_name = excluded.admin_name`
  )
    .bind(sessionId, now, userAgent || '', now, name)
    .run();

  // Drop stale sessions (older than 10 minutes) so the table stays small
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM admin_presence WHERE last_seen < ?').bind(staleBefore).run();

  return d1PresenceList(env);
}

async function d1PresenceCount(env) {
  const result = await d1PresenceList(env);
  return result.online;
}

async function d1PresenceList(env) {
  await d1EnsurePresenceTable(env);
  const since = new Date(Date.now() - PRESENCE_ONLINE_MS).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT admin_name FROM admin_presence WHERE last_seen >= ? ORDER BY last_seen DESC'
  )
    .bind(since)
    .all();
  const rows = results || [];
  const names = [];
  const seen = Object.create(null);
  for (const r of rows) {
    const n = (r && r.admin_name) ? String(r.admin_name).trim() : '';
    if (n && !seen[n]) {
      seen[n] = true;
      names.push(n);
    }
  }
  // Count sessions (not unique names) so multiple devices by same person still show activity
  return { online: rows.length, names };
}

/** Permanent delete (after 30-day trash or explicit purge). */
async function d1HardDeleteClient(env, clientId) {
  const id = String(clientId);
  const at = new Date().toISOString();
  await d1BatchWithRetry(env, () => [
    env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(at, 'delete_client', 'client', id, 'purge')
  ]);
}

/** Move client to trash (recoverable for 30 days). */
async function d1TrashClient(env, clientId) {
  const id = String(clientId);
  const now = new Date().toISOString();
  await d1BatchWithRetry(env, () => [
    env.DB.prepare(
      `UPDATE clients SET deleted_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(now, 'trash_client', 'client', id, 'trash')
  ]);
}

async function d1RestoreClient(env, clientId) {
  const id = String(clientId);
  const now = new Date().toISOString();
  await d1BatchWithRetry(env, () => [
    env.DB.prepare(
      `UPDATE clients SET deleted_at = NULL, updated_at = ? WHERE id = ?`
    ).bind(now, id),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(now, 'restore_client', 'client', id, 'restore')
  ]);
}

/** Soft archive: membership_status only (not trash). */
async function d1ArchiveClient(env, clientId) {
  const id = String(clientId);
  const now = new Date().toISOString();
  await d1BatchWithRetry(env, () => [
    env.DB.prepare(
      `UPDATE clients SET membership_status = 'arquivado', updated_at = ? WHERE id = ?`
    ).bind(now, id),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(now, 'archive_client', 'client', id, 'soft')
  ]);
}

function d1SubmissionUpsertStmt(env, s) {
  const now = new Date().toISOString();
  const payload = JSON.stringify(s);
  return env.DB.prepare(
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
  ).bind(
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
  );
}

async function d1UpsertSubmission(env, s) {
  await d1BatchWithRetry(env, () => [d1SubmissionUpsertStmt(env, s)]);
}

/** Soft-delete submission to trash (recoverable 30 days). */
async function d1TrashSubmission(env, id) {
  const sid = String(id);
  const now = new Date().toISOString();
  await d1BatchWithRetry(env, () => [
    env.DB.prepare(
      `UPDATE submissions SET deleted_at = ?, status = 'eliminado', updated_at = ? WHERE id = ?`
    ).bind(now, now, sid),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(now, 'trash_submission', 'submission', sid, 'trash')
  ]);
}

async function d1RestoreSubmission(env, id) {
  const sid = String(id);
  const now = new Date().toISOString();
  // Restore to 'arquivado' so it does not reappear as "novo" in the main inbox
  await d1BatchWithRetry(env, () => [
    env.DB.prepare(
      `UPDATE submissions SET deleted_at = NULL, status = 'arquivado', updated_at = ? WHERE id = ?`
    ).bind(now, sid),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(now, 'restore_submission', 'submission', sid, 'restore')
  ]);
}

async function d1HardDeleteSubmission(env, id) {
  const sid = String(id);
  const at = new Date().toISOString();
  await d1BatchWithRetry(env, () => [
    env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(sid),
    env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).bind(at, 'delete_submission', 'submission', sid, 'purge')
  ]);
}

/** Permanently delete trash older than `days` (default 30). */
async function d1PurgeTrash(env, days) {
  days = days > 0 ? days : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const clients = await env.DB.prepare(
    'SELECT id FROM clients WHERE deleted_at IS NOT NULL AND deleted_at < ?'
  )
    .bind(cutoff)
    .all();
  const submissions = await env.DB.prepare(
    'SELECT id FROM submissions WHERE deleted_at IS NOT NULL AND deleted_at < ?'
  )
    .bind(cutoff)
    .all();
  let clientsPurged = 0;
  let submissionsPurged = 0;
  for (const row of clients.results || []) {
    await d1HardDeleteClient(env, row.id);
    clientsPurged++;
  }
  for (const row of submissions.results || []) {
    await d1HardDeleteSubmission(env, row.id);
    submissionsPurged++;
  }
  const at = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO audit_log (at, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      at,
      'purge_trash',
      'store',
      null,
      JSON.stringify({ days, cutoff, clientsPurged, submissionsPurged })
    )
    .run();
  return {
    ok: true,
    days,
    cutoff,
    clientsPurged,
    submissionsPurged
  };
}

function d1NewsletterUpsertStmt(env, n) {
  const id = String(n.id || n.phone || ('nl-' + Date.now()));
  return env.DB.prepare(
    `INSERT INTO newsletters (id, phone, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET phone=excluded.phone, name=excluded.name`
  ).bind(id, n.phone || null, n.name || null, n.createdAt || new Date().toISOString());
}

async function d1UpsertNewsletter(env, n) {
  await d1BatchWithRetry(env, () => [d1NewsletterUpsertStmt(env, n)]);
}

async function d1DeleteNewsletter(env, id) {
  await d1BatchWithRetry(env, () => [
    env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(String(id))
  ]);
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

/* ========== Member portal (/client/auth) ========== */

function b64url(bytes) {
  let s;
  if (typeof bytes === 'string') {
    s = btoa(bytes);
  } else {
    let bin = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    s = btoa(bin);
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(env) {
  const secret = String(env.CLIENT_TOKEN_SECRET || env.ADMIN_PASSWORD || 'buzios-client').trim();
  const raw = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(env, clientId, ttlSec) {
  const exp = Math.floor(Date.now() / 1000) + (ttlSec || 60 * 60 * 24 * 30);
  const payload = b64url(String(clientId)) + '.' + b64url(String(exp));
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return payload + '.' + b64url(new Uint8Array(sig));
}

async function verifyToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  const key = await hmacKey(env);
  let sigBytes;
  try {
    sigBytes = fromB64url(parts[2]);
  } catch (_) {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  if (!ok) return null;
  let clientId;
  let exp;
  try {
    clientId = new TextDecoder().decode(fromB64url(parts[0]));
    exp = parseInt(new TextDecoder().decode(fromB64url(parts[1])), 10);
  } catch (_) {
    return null;
  }
  if (!clientId || !exp || exp * 1000 < Date.now()) return null;
  return clientId;
}

async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  let salt;
  if (saltB64) {
    salt = fromB64url(saltB64);
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
  }
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return b64url(salt) + '$' + b64url(new Uint8Array(bits));
}

async function verifyPassword(password, stored) {
  if (!stored || stored.indexOf('$') < 0) return false;
  const saltB64 = stored.split('$')[0];
  const check = await hashPassword(password, saltB64);
  return check === stored;
}

function publicClient(c) {
  if (!c) return null;
  return {
    id: c.id,
    memberNumber: c.memberNumber,
    name: c.name,
    phone: c.phone,
    email: c.email,
    area: c.area,
    planId: c.planId,
    planName: c.planName,
    price: c.price,
    billingCycle: c.billingCycle,
    planStart: c.planStart,
    planEnd: c.planEnd,
    membershipStatus: c.membershipStatus,
    billingStatus: c.billingStatus,
    lastPaymentAt: c.lastPaymentAt,
    payments: c.payments || [],
    emergencyName: c.emergencyName,
    emergencyPhone: c.emergencyPhone,
    photoUrl: c.photoUrl || null,
    accountStatus: c.accountStatus || null
  };
}

async function d1FindClientByEmail(env, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const res = await env.DB.prepare(
    `SELECT * FROM clients
     WHERE lower(email) = ?
       AND (deleted_at IS NULL OR deleted_at = '')
     LIMIT 1`
  )
    .bind(normalized)
    .first();
  return res ? rowToClient(res) : null;
}

async function d1FindClientById(env, id) {
  if (!id) return null;
  const res = await env.DB.prepare(
    `SELECT * FROM clients WHERE id = ? AND (deleted_at IS NULL OR deleted_at = '') LIMIT 1`
  )
    .bind(String(id))
    .first();
  return res ? rowToClient(res) : null;
}

async function d1GetPasswordHash(env, id) {
  const res = await env.DB.prepare(
    `SELECT password_hash FROM clients WHERE id = ? LIMIT 1`
  )
    .bind(String(id))
    .first();
  return res && res.password_hash ? String(res.password_hash) : null;
}

async function d1SetPasswordHash(env, id, hash) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE clients SET password_hash = ?, account_status = 'active', last_login_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(hash, now, now, String(id))
    .run();
}

async function d1ClearPassword(env, id) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE clients SET password_hash = NULL, account_status = NULL, updated_at = ? WHERE id = ?`
  )
    .bind(now, String(id))
    .run();
}

async function d1TouchLogin(env, id) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE clients SET last_login_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(now, now, String(id))
    .run();
}

async function handleClientAuth(request, env) {
  if (!env.DB) {
    return json({ error: 'Base de dados indisponível' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Pedido inválido' }, 400);
  }

  const action = body && body.action;
  if (!action) return json({ error: 'Acção em falta' }, 400);

  try {
    if (action === 'login') {
      const email = String((body.email || '')).trim();
      const password = String(body.password || '');
      if (!email || !password) return json({ error: 'Email e palavra-passe são obrigatórios' }, 400);
      const client = await d1FindClientByEmail(env, email);
      if (!client) return json({ error: 'Email ou palavra-passe incorrectos' }, 401);
      const hash = await d1GetPasswordHash(env, client.id);
      if (!hash) {
        return json({
          error: 'Ainda não tem conta online. Use «Criar conta» com o email do registo de sócio.'
        }, 401);
      }
      const ok = await verifyPassword(password, hash);
      if (!ok) return json({ error: 'Email ou palavra-passe incorrectos' }, 401);
      await d1TouchLogin(env, client.id);
      const token = await signToken(env, client.id);
      return json({ ok: true, token: token, client: publicClient(client) });
    }

    if (action === 'register') {
      const email = String((body.email || '')).trim();
      const password = String(body.password || '');
      if (!email || !password) return json({ error: 'Email e palavra-passe são obrigatórios' }, 400);
      if (password.length < 6) return json({ error: 'A palavra-passe deve ter pelo menos 6 caracteres' }, 400);
      const client = await d1FindClientByEmail(env, email);
      if (!client) {
        return json({
          error: 'Este email não está associado a um registo de sócio. Contacte o ginásio.'
        }, 404);
      }
      const existing = await d1GetPasswordHash(env, client.id);
      if (existing) {
        return json({
          error: 'Já existe uma conta online para este email. Use «Entrar».'
        }, 409);
      }
      const hash = await hashPassword(password);
      await d1SetPasswordHash(env, client.id, hash);
      const token = await signToken(env, client.id);
      const refreshed = await d1FindClientById(env, client.id);
      return json({ ok: true, token: token, client: publicClient(refreshed || client) });
    }

    if (action === 'me') {
      const clientId = await verifyToken(env, body.token);
      if (!clientId) return json({ error: 'Sessão inválida ou expirada' }, 401);
      const client = await d1FindClientById(env, clientId);
      if (!client) return json({ error: 'Sessão inválida' }, 401);
      return json({ ok: true, client: publicClient(client) });
    }

    if (action === 'change_password') {
      const clientId = await verifyToken(env, body.token);
      if (!clientId) return json({ error: 'Sessão inválida ou expirada' }, 401);
      const current = String(body.currentPassword || body.oldPassword || '');
      const next = String(body.newPassword || body.password || '');
      if (!current || !next) return json({ error: 'Palavras-passe em falta' }, 400);
      if (next.length < 6) return json({ error: 'A nova palavra-passe deve ter pelo menos 6 caracteres' }, 400);
      const hash = await d1GetPasswordHash(env, clientId);
      if (!hash || !(await verifyPassword(current, hash))) {
        return json({ error: 'Palavra-passe actual incorrecta' }, 401);
      }
      const newHash = await hashPassword(next);
      await d1SetPasswordHash(env, clientId, newHash);
      return json({ ok: true });
    }

    if (action === 'delete_account') {
      const clientId = await verifyToken(env, body.token);
      if (!clientId) return json({ error: 'Sessão inválida ou expirada' }, 401);
      await d1ClearPassword(env, clientId);
      return json({ ok: true });
    }

    return json({ error: 'Acção desconhecida' }, 400);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    // Missing portal columns → migration not applied yet
    if (/no such column|password_hash|account_status|photo_url/i.test(msg)) {
      return json({
        error: 'Portal do membro ainda não está activo no servidor. Peça à equipa para aplicar a migração 0003_client_portal.',
        code: 'migration_required'
      }, 503);
    }
    console.error('client/auth', msg);
    return json({ error: 'Erro no servidor' }, 500);
  }
}
