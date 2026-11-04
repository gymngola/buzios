# Búzios Health Club — Website

Luxury mobile-first brochure + admin site for **Búzios Health Club / Escola de Natação Búzios** (Kifica, Benfica, Luanda).

**Live site:** https://www.buzioshealthclub.com

## Stack

- Pure HTML / CSS / JS (no build step)
- **Cloudflare Pages** — static site (`index.html`, etc.)
- **Cloudflare Worker** (`buzios-publish`) — publish, forms, admin inbox, fresh catalog proxy
- **Cloudinary**
  - Unsigned preset `buzios_unsigned` — browser image/doc uploads only
  - Signed raw upload (Worker + Root API key) — `buzios/catalog.json` + `buzios/store.json`
  - `invalidate=true` on every signed upload (CDN caches raw files ~30 days otherwise)
- **localStorage** — admin mid-session drafts only (not cross-browser source of truth)
- Orders / leads via WhatsApp (no payment backend)
- **PWA** — installable as apps (public site + admin)
  - `manifest.json` → public site (“Búzios”)
  - `admin-manifest.json` → admin panel (“Búzios Admin”)
  - `sw.js` — service worker (app shell cache)
  - Icons in `/icons/`

## Pages

| File | Description |
|------|-------------|
| `index.html` | Home — hero, about, services, plans teaser |
| `ginasio.html` | Gym equipment & plans |
| `natacao.html` | Swimming school |
| `planos.html` | All plans & prices |
| `inscricao.html` | Enrollment form |
| `contacto.html` | Contact form |
| `admin.html` | Staff panel (password-gated, noindex) |
| `robots.txt` | Search engine crawl rules |
| `sitemap.xml` | XML sitemap for Google |
| `manifest.json` | PWA manifest — public site |
| `admin-manifest.json` | PWA manifest — admin |
| `sw.js` | Service worker (app shell) |
| `icons/` | App icons (192 / 512 + Apple) |

## Setup checklist

### 1. Cloudinary

- Cloud name: `ogtzpc3v` (in client JS)
- Unsigned preset: `buzios_unsigned` (folder: `buzios`, overwrite off)
- **Worker secrets use the Root API key** (or any key with upload + Admin API access)
- One Cloudinary account can serve many client sites — separate them with **folders + presets**, not extra API keys
- API key + secret go **only** into Worker secrets (never in the browser or git)

### 2. Worker (required)

Always deploy from the **`worker/`** folder — never from the project root:

```bash
cd worker
ls                    # must show: src  wrangler.toml
grep -n "count:" src/index.js   # sanity check new code is present

npx wrangler secret put ADMIN_PASSWORD          # same as js/admin.js
npx wrangler secret put CLOUDINARY_CLOUD_NAME   # ogtzpc3v
npx wrangler secret put CLOUDINARY_API_KEY      # Root key recommended
npx wrangler secret put CLOUDINARY_API_SECRET   # exact secret, no trailing newline

npx wrangler deploy
```

Live base: `https://buzios-publish.gymngola.workers.dev`

| Route | Purpose |
|-------|---------|
| `GET /catalog` | Fresh catalog (bypasses Cloudinary CDN cache) |
| `POST /submit` | Public — enrollment, contact, newsletter |
| `POST /publish` | Admin — write `buzios/catalog.json` |
| `POST /admin/data` | Admin — read/update store (inbox, clients, newsletter) |

After any change to `worker/src/index.js`, run `npx wrangler deploy` again from `worker/`.

**Do not** run `npx wrangler deploy` from the project root (it tries to create a static Assets Worker named `buzios`). Static site = Cloudflare Pages only.

### 3. Admin password

Default in `js/admin.js`: `buzios2026` — change after handoff and set the same value as Worker `ADMIN_PASSWORD`.

### 4. Deploy static site

Cloudflare Pages → project root (folder with `index.html`).  
Push to GitHub or upload; **not** `wrangler deploy` from root.

### 5. Smoke test

```bash
# 1. Form write — expect "count" in the response
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/submit" \
  -H "Content-Type: application/json" \
  -d '{"type":"contact","name":"Test","phone":"900000000","message":"ping"}'
# expect: {"ok":true,"id":"...","count":1}

# 2. Admin read — expect submissions length >= 1
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"buzios2026","action":"get"}'
```

Then:

- Hard-refresh admin → **Inscrições** shows the contact
- Enrollment form → Inscrições + Clientes
- Admin → assign image to a slot → **Publicar na loja** → hard-refresh public site
- Catalog is loaded via Worker `GET /catalog` (not the raw Cloudinary URL)

### 6. Install as apps (PWA)

After deploy, both the public site and the admin panel can be installed:

| App | Open this URL | Result |
|-----|---------------|--------|
| **Búzios** (public) | `https://www.buzioshealthclub.com/` | Install “Búzios” |
| **Búzios Admin** | `https://www.buzioshealthclub.com/admin.html` | Install “Búzios Admin” |

**How to install**
- **Android / Chrome**: menu → “Install app” / “Add to Home screen”
- **iOS Safari**: Share → “Add to Home Screen”
- **Desktop Chrome/Edge**: install icon in the address bar

Each installs as its own standalone app (different icons and names). The service worker caches the shell so the UI opens offline; live data (catalog, forms) still needs network.

## How data flows

### Catalog (plans, texts, site images)

1. Admin edits in memory / optional **Guardar rascunho** (this browser only, dirty flag)
2. **Publicar na loja** → Worker signs upload → `buzios/catalog.json` (+ CDN invalidate)
3. Public site + admin load via `GET https://buzios-publish.gymngola.workers.dev/catalog`
4. On admin load: remote catalog is source of truth; local draft only if dirty

### Store (inscriptions, contact, newsletter, clients)

1. Public forms → `POST /submit`
2. Worker: **Workers Cache** (immediate) + Cloudinary `buzios/store.json` (durable)
3. Admin → `POST /admin/data` reads the richer of cache + Cloudinary (avoids empty inbox from CDN lag)

### Site images

- Upload to Cloudinary with unsigned preset (or pick from media library)
- Assign to a slot → **Publicar na loja**
- Library alone does not update the public site

## Cloudinary assets

| Public ID | Written by | Read by |
|-----------|------------|---------|
| `buzios/catalog.json` | `POST /publish` | Worker `GET /catalog` → public + admin |
| `buzios/store.json` | `POST /submit`, `POST /admin/data` | Worker (cache + Admin API / delivery) |

Signed upload signature params (alphabetical): `invalidate`, `overwrite`, `public_id`, `timestamp` + API secret.

**Permissions:** restricted keys often fail Admin API / create — use **Root** for Worker secrets.

**Invalid Signature:** mismatched key/secret or trailing newline in `CLOUDINARY_API_SECRET`.

**CDN lag:** delivery URLs for raw JSON use `max-age=2592000`. Always use Worker `/catalog` and Worker store load — never rely on unversioned `res.cloudinary.com/.../catalog.json` alone for live data.

## Brand

- Name: **Búzios** / Health Club  
- Secondary: La Casa de Ferro / Escola de Natação Búzios  
- WhatsApp ginásio: +244 923 423 142  
- WhatsApp natação: +244 929 208 317  
- IBAN: A006 0040 0000 6810 2585 1017 3  
- Address: Rua 21-c, Bairro do Benfica, Kifica nº 57-59, Luanda  

## Visual system

- Quiet luxury — warmer paper background, terracotta accent, soft elevation  
- Cormorant Garamond (titles) + Inter (body)  
- Thin borders, generous whitespace, light type (300–500)  
- Mobile-first, safe-area, Portuguese first  

## Notes

- Media “delete” in admin removes the library list entry only (not the Cloudinary file)
- Admin tab is remembered in `sessionStorage` across reloads
- Keep `public_id` paths as `buzios/catalog.json` and `buzios/store.json` (with extension)
