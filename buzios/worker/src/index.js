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

async function handlePublish(request, env) {
  const body = await request.json();
  const { password, catalog } = body || {};
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!catalog || typeof catalog !== 'object') {
    return json({ error: 'Missing catalog' }, 400);
  }
  const result = await uploadRaw(env, FOLDER + '/catalog', JSON.stringify(catalog, null, 2));
  return json({ ok: true, url: result.secure_url, updatedAt: catalog.updatedAt });
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
      planId: payload.planId,
      planName: payload.planName,
      name: payload.name,
      phone: payload.phone,
      email: payload.email || '',
      age: payload.age,
      emergency: payload.emergency || '',
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
        planId: payload.planId || '',
        planName: payload.planName || '',
        membershipStatus: 'pendente',
        billingStatus: 'em_dia',
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
      message: payload.message || payload.notes || '',
      createdAt: payload.createdAt || new Date().toISOString()
    });
  }

  if (store.submissions && store.submissions.length > 500) store.submissions = store.submissions.slice(0, 500);
  if (store.newsletters && store.newsletters.length > 1000) store.newsletters = store.newsletters.slice(0, 1000);
  if (store.clients && store.clients.length > 500) store.clients = store.clients.slice(0, 500);

  store.updatedAt = new Date().toISOString();
  await uploadRaw(env, FOLDER + '/store', JSON.stringify(store));
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

  if (action === 'update_submission' && data && data.id) {
    store.submissions = store.submissions || [];
    const idx = store.submissions.findIndex(s => s.id === data.id);
    if (idx >= 0) {
      store.submissions[idx] = Object.assign({}, store.submissions[idx], data, { id: data.id });
    }
    store.updatedAt = new Date().toISOString();
    await uploadRaw(env, FOLDER + '/store', JSON.stringify(store));
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
    await uploadRaw(env, FOLDER + '/store', JSON.stringify(store));
    return json({ ok: true, store });
  }

  if (action === 'delete_submission' && data && data.id) {
    store.submissions = (store.submissions || []).filter(s => s.id !== data.id);
    store.updatedAt = new Date().toISOString();
    await uploadRaw(env, FOLDER + '/store', JSON.stringify(store));
    return json({ ok: true, store });
  }

  if (action === 'replace_store' && data) {
    store = data;
    store.updatedAt = new Date().toISOString();
    await uploadRaw(env, FOLDER + '/store', JSON.stringify(store));
    return json({ ok: true, store });
  }

  return json({ error: 'Unknown action' }, 400);
}

async function loadStore(env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const url = 'https://res.cloudinary.com/' + cloudName + '/raw/upload/' + FOLDER + '/store.json?t=' + Date.now();
  try {
    const res = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (res.ok) {
      return await res.json();
    }
  } catch (_) {}
  return { submissions: [], clients: [], newsletters: [], classes: [], updatedAt: null };
}

async function uploadRaw(env, publicId, content) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Server misconfigured');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = 'public_id=' + publicId + '&timestamp=' + timestamp + apiSecret;
  const signature = await sha1(toSign);

  const form = new FormData();
  form.append('file', new Blob([content], { type: 'application/json' }), publicId.split('/').pop() + '.json');
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('public_id', publicId);
  form.append('signature', signature);
  form.append('resource_type', 'raw');
  form.append('overwrite', 'true');

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
