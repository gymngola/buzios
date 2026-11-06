# Búzios Health Club — Website

Luxury mobile-first brochure + admin site for **Búzios Health Club / Escola de Natação Búzios** (Kifica, Benfica, Luanda).

**Live site:** https://www.buzioshealthclub.com

## Documentation rule

**Update this README and `BLUEPRINT.md` on every significant or important change** (UX redesigns, data flow, brand assets, Worker behaviour, new admin features, deploy process). Do not leave docs lagging behind the code.

| Doc | Role |
|-----|------|
| `README.md` | Setup, deploy, smoke tests, stack, quick reference |
| `BLUEPRINT.md` | Product/architecture blueprint: pages, admin workflow, data model, brand, UX decisions |

## Stack

- Pure HTML / CSS / JS (no build step)
- **Cloudflare Pages** — static site (`index.html`, etc.)
- **Cloudflare Worker** (`buzios-publish`) — publish, forms, admin inbox, fresh catalog proxy
- **Cloudinary**
  - Unsigned preset `buzios_unsigned` — browser image/doc uploads only
  - Signed raw upload (Worker + Root API key) — `buzios/catalog.json` + `buzios/store.json` (+ `store-prev.json` backup)
  - `invalidate=true` on every signed upload (CDN caches raw files ~30 days otherwise)
- **Cloudflare D1** (`buzios-db`) — **clients live here** (read + dual-write on admin update/delete). Inbox/newsletter still Cloudinary for now. Catalog stays on Cloudinary. See `worker/SETUP-D1.md`.
- **localStorage** — admin mid-session drafts only (catalog dirty flag; not cross-browser source of truth)
- Orders / leads via WhatsApp (no payment backend)
- **PWA** — installable as apps (public site + admin)
  - `manifest.json` → public site (“Búzios”)
  - `admin-manifest.json` → admin panel (“Búzios Admin”)
  - `sw.js` — service worker (app shell cache)
  - Icons in `/icons/` (including brand logo `logo.png` / `logo.jpg`)

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
| `icons/` | App icons + brand logo (`logo.png`) |
| `BLUEPRINT.md` | Architecture & product blueprint |

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
| `POST /admin/data` | Admin — read/update store (inbox, clients, newsletter) + D1 ops |

`POST /admin/data` actions (password required): `get`, `update_*`, `delete_*`, `replace_store`, `debug_store`, **`d1_status`**, **`d1_import_from_store`**, **`d1_get_clients`**.

After any change to `worker/src/index.js`, run `npx wrangler deploy` again from `worker/`.

**Do not** run `npx wrangler deploy` from the project root (it tries to create a static Assets Worker named `buzios`). Static site = Cloudflare Pages only.

### 2b. D1 (clients / inbox) — setup once

Operational data is moving to D1 so membership edits are row-level (no whole-file overwrite). Full steps: **`worker/SETUP-D1.md`**.

```bash
cd worker
npx wrangler d1 create buzios-db          # paste database_id into wrangler.toml
npx wrangler d1 migrations apply buzios-db --remote
npx wrangler deploy

# status + one-time import from Cloudinary store
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"…","action":"d1_status"}'
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"…","action":"d1_import_from_store"}'
```

**Clients:** admin reads from D1 (`d1_get_clients`); admin updates dual-write Cloudinary + D1.  
Inbox / newsletter still Cloudinary until the next phase.

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

**Today (live):** still Cloudinary `buzios/store.json`.  
**Target:** same data in **D1** (row per client); catalog stays on Cloudinary.

1. Public forms → `POST /submit`
2. Worker **writes**: Cloudinary `buzios/store.json` first (signed upload + `invalidate`), then Workers Cache; also writes `buzios/store-prev.json` as last-good backup
3. Worker **reads**: Admin API versioned URL / delivery (query cache-bust only — **never** `fetch(..., { cache: 'no-store' })` inside Workers; that option throws and made Cloudinary look empty)
4. Prefer newer `updatedAt`, then richness; **never** prefer an empty snapshot over real data
5. `saveStore` **refuses** to overwrite a non-empty store with an empty one
6. Admin `applyStore` **blocks** empty remote overwriting a non-empty local list
7. Admin `loadStore()` dual-reads Worker + Cloudinary on first load; silent polls use Worker only
8. **Backup** (Clientes → Backup) downloads full JSON: store + catalog — use before bulk deletes or re-imports

`replace_store` ignores empty `clients` / `submissions` arrays unless `data._forceReplace === true` (recovery/import only).
### Site images

- Upload to Cloudinary with unsigned preset (or pick from media library)
- Assign to a slot → **Publicar na loja**
- Library alone does not update the public site

## Cloudinary assets

| Public ID | Written by | Read by |
|-----------|------------|---------|
| `buzios/catalog.json` | `POST /publish` | Worker `GET /catalog` → public + admin |
| `buzios/store.json` | `POST /submit`, `POST /admin/data` | Worker (Admin API versioned + delivery + cache); admin dual-read fallback |
| `buzios/store-prev.json` | `saveStore` (automatic) | Recovery only |

Signed upload signature params (alphabetical): `invalidate`, `overwrite`, `public_id`, `timestamp` + API secret.

**Permissions:** use **Root** API key for Worker secrets (upload + Admin API).

**Invalid Signature:** mismatched key/secret or trailing newline in `CLOUDINARY_API_SECRET` — Worker trims secrets; still paste the exact secret with no extra newline when running `wrangler secret put`.

**CDN lag:** delivery URLs for raw JSON use `max-age=2592000`. Catalog: always use Worker `GET /catalog`. Store: versioned Admin API URL when possible; query cache-bust on delivery fallback.

**Workers runtime note:** do **not** pass `{ cache: 'no-store' }` to `fetch` inside the Worker — it throws (`cache` field not implemented) and breaks Cloudinary reads. Bust cache with `?_=timestamp` only.

**Debug store (ops):**  
`POST /admin/data` with `{"password":"…","action":"debug_store"}` returns secret presence, delivery probe, cache vs Cloudinary scores, `cloudLoadDebug`, and `chosenClients`. Healthy: `cloudLoadDebug.step` = `ok_admin` or `ok_delivery`, `cloudinary.clients` > 0.
## Brand

- Name: **Búzios** / Health Club  
- Secondary: **La Casa de Ferro** / Escola de Natação Búzios  
- Logo: `icons/logo.png` (circular mark) — used in public header, mobile drawer, footer, admin nav, admin login, and PWA icons
- **Google search favicon:** `/favicon.ico` + `icons/favicon-48.png` / `96` / `192` on every public page (shown next to the URL in Google results; Google’s cache can take days–weeks to refresh)  
- WhatsApp ginásio: +244 923 423 142  
- WhatsApp natação: +244 929 208 317  
- IBAN: A006 0040 0000 6810 2585 1017 3  
- Address: Rua 21-c, travessa 5, Bairro do Benfica, Kifica nº 57-59, Luanda  
- Google Maps link uses business name search (`Buzios health club Luanda`) so the place panel opens reliably even when the full street text includes “travessa 5”  

## Visual system

- Quiet luxury — warmer paper background, terracotta accent, soft elevation  
- **Montserrat** (titles, brand, nav, buttons — geometric, in tune with logo) + **Inter** (body) on public site; Inter on admin  
- Thin borders, generous whitespace  
- Mobile-first, safe-area, Portuguese first  

## Admin — Clientes (summary)

Dense operational list for membership staff:

- Sticky status strip (Activos / A expirar / Expirados / Em dívida / Pendentes)
- Default sort: priority (dívida → a expirar → rest)
- Row layout with days-left pills and left border for debt / expiring
- Primary actions: Renovar, WhatsApp; secondary under **Mais** (closes on outside click / Escape)
- Bulk bar + floating bar: WhatsApp, Suspender, Arquivar, Exportar, Apagar
- Shortcuts on Clientes panel: `/` focus search, `N` new client
- **Backup** — full JSON (store + catalog) for recovery
- Export CSV / Copiar telefones respect current selection when present

See `BLUEPRINT.md` for full workflow and data fields.

## Admin — Inscrições (summary)

Enrollment pipeline (reversible statuses):

**Novo → Contactado → Aguarda docs → Inscrito → Arquivar**

- **Criar cliente** — membership **activo**, submission **inscrito**
- **Criar pendente (docs)** — membership **pendente** until documents are complete
- **Arquivar** closes the ticket (does not delete the client in Clientes)
- Filters + bulk status actions; see `BLUEPRINT.md` §4.1

## Multi-device admin

Several staff devices can keep admin open:

- Store polled about every **7 seconds** while the tab is visible; also on tab focus
- Newer `store.updatedAt` wins; toast **Actualizado noutro dispositivo**
- Worker `update_client` re-loads store before write (reduces lost updates across devices)
- Same client edited at the same time → last write wins

## Recent changes

### 2026-11-06 — Submit + inbox dual-write to D1

- Public `/submit` dual-writes enrollment/contact/newsletter → Cloudinary + D1.
- New enrollment also creates client row in D1 when phone is new.
- Admin `update_submission` / `delete_submission` / `delete_newsletter` dual-write D1.
- Admin still **reads** inbox from Cloudinary store (next: read from D1).
- Catalog stays on Cloudinary.

### 2026-11-06 — Clients on D1 (read + dual-write)

- Admin **reads clients from D1** (`d1_get_clients` overlay after every store load / client mutation).
- Admin **update_client / delete_client** dual-write: Cloudinary store (backup) + D1 row upsert/delete.

### 2026-11-06 — Store durability + D1 foundation

- **Root cause of empty Clientes:** Worker `fetch(..., { cache: 'no-store' })` throws on Cloudflare Workers runtime → Cloudinary load failed → UI sometimes showed 0 clients. Removed that option; cache-bust via query string only.
- **Guards:** `saveStore` refuses empty overwrite; auto-writes `buzios/store-prev.json`; admin `applyStore` blocks empty remote over non-empty local list.
- **D1 foundation:** `worker/migrations/0001_init.sql`, D1 binding in `wrangler.toml`, actions `d1_status` / `d1_import_from_store` / `d1_get_clients`. Setup guide: `worker/SETUP-D1.md`.
- Long-term split: **catalog → Cloudinary JSON**; **clients/inbox → D1** (row-level).

### 2026-11-04 → 2026-11-05

- **Clientes admin redesign** — denser rows, sticky summary/filters, priority actions, floating bulk bar, keyboard shortcuts, outside-click **Mais** menu
- **Brand logo** — `icons/logo.png` on public header, drawer, footer; admin nav + login; PWA icons regenerated from logo artwork
- **Google favicon** — `/favicon.ico` + `icons/favicon-48/96/192.png` on all public pages so search results can show the logo next to the URL
- **Typography** — Montserrat for titles/brand/nav/buttons (matches logo); Inter for body text
- **Docs** — `BLUEPRINT.md` added; README maintenance rule documented
- **Clients store limit** — Worker cap raised from 500 to **3000** (redeploy Worker to apply)
- **Excel import** — cleaned membership dump (~264 clients); see `IMPORT.md`, `import-clients.json`, `import-clients-payload.json`
- **Store durability** — Worker writes Cloudinary before cache; reads prefer Cloudinary delivery; admin dual-reads Cloudinary if Worker returns a thinner store
- **Backup button** — Clientes → Backup downloads `buzios-backup-YYYY-MM-DD.json` (full store + catalog)
- **Safety** — `replace_store` will not wipe clients with an empty array unless `_forceReplace: true`
- **Import notes cleanup (2026-11-05)** — provisional Excel notes removed from all clients; structured fields filled (`IMPORT.md`)
- **Client Expirado save** — explicit status kept; `planEnd` backdated when marking expired with a future date
- **Inscrições flow** — reversible statuses, `pendente_docs`, create client vs create pending
- **Multi-device sync** — admin poll + focus refresh; Worker pre-write reload on `update_client`
- **Login flash fixed** — session resume without showing login first
- **Small-phone CSS** — iPhone 6s-class layout; SW `buzios-v3` network-first for HTML/JS/CSS

## Notes

- Media “delete” in admin removes the library list entry only (not the Cloudinary file)
- Admin tab is remembered in `sessionStorage` across reloads
- Auth: `sessionStorage` / `localStorage` key `buzios_admin_auth`; “Manter sessão iniciada” uses `localStorage`
- Keep `public_id` paths as `buzios/catalog.json` and `buzios/store.json` (with extension)
- After significant product/UX/infra changes: update **README.md** and **BLUEPRINT.md** in the same change set
- Deploy: **Pages** = static root; **Worker** = always `cd worker && npx wrangler deploy` (never from project root)
