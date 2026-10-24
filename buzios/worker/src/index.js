/**
 * Búzios Publish Worker
 * Receives catalog + password, signs Cloudinary raw upload of catalog.json
 *
 * Secrets (wrangler secret put):
 *   ADMIN_PASSWORD
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/publish' && url.pathname !== '/') {
      return json({ error: 'Not found' }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { password, catalog } = body || {};
    if (!password || password !== env.ADMIN_PASSWORD) {
      return json({ error: 'Unauthorized' }, 401);
    }
    if (!catalog || typeof catalog !== 'object') {
      return json({ error: 'Missing catalog' }, 400);
    }

    const cloudName = env.CLOUDINARY_CLOUD_NAME;
    const apiKey = env.CLOUDINARY_API_KEY;
    const apiSecret = env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      return json({ error: 'Server misconfigured' }, 500);
    }

    const folder = 'buzios';
    const publicId = `${folder}/catalog`;
    const timestamp = Math.floor(Date.now() / 1000);
    const fileContent = JSON.stringify(catalog, null, 2);

    // Signature for raw upload
    // Params to sign (alphabetical): public_id, timestamp
    const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = await sha1(toSign);

    const form = new FormData();
    form.append('file', new Blob([fileContent], { type: 'application/json' }), 'catalog.json');
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('public_id', publicId);
    form.append('signature', signature);
    form.append('resource_type', 'raw');
    form.append('overwrite', 'true');

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
      { method: 'POST', body: form }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return json({ error: 'Cloudinary upload failed', detail: errText }, 502);
    }

    const result = await uploadRes.json();
    return json({
      ok: true,
      url: result.secure_url,
      public_id: result.public_id,
      updatedAt: catalog.updatedAt
    });
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

async function sha1(message) {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
