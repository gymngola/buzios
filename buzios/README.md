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
- **Cloudflare D1** (`buzios-db`) — clients, inbox/submissions, newsletter, trainings, presence, audit_log, admin_settings. Catalog stays on Cloudinary. See `worker/SETUP-D1.md`.
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

`POST /admin/data` actions (password required): `auth`, `force_logout_all`, `get`, `update_*`, `delete_*`, `replace_store`, `debug_store`, **`d1_status`**, **`d1_import_from_store`**, **`d1_get_clients`**, **`d1_get_submissions`**, **`d1_get_newsletters`**, **`d1_backup`**, **`get_audit_log`**, **`add_training`**, **`delete_training`**, **`list_trainings`**, **`trainings_summary`**, **`get_client_history`**, **`presence_heartbeat`**, **`presence_leave`**, **`presence_get`**.

Optional body field on mutations: `adminName` (staff name from login dropdown) — written into audit detail and presence.

After any change to `worker/src/index.js`, run `npx wrangler deploy` again from `worker/`. Apply new migrations when present:

```bash
cd worker
npx wrangler d1 migrations apply buzios-db --remote
npx wrangler deploy
```

Migrations of note: `0004` presence · `0005` admin_name · `0006` trainings · `0007` admin_settings (`auth_epoch`).

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

**Clients / inbox / newsletter:** D1 is primary (cutover 2026-11-06). Admin reads via `d1_get_*`. Mutations write D1 only (`WRITE_OPS_TO_STORE = false`).  
**Clientes UI:** server/Cloudinary `store.clients` is never painted into the list/stats (it lags the cron backup). `applyStore` keeps existing clients and `loadStore` waits for `d1_get_clients` (shows “A carregar clientes…” on hard reload) so stats do not flash stale counts.  
**Backup:** `action: "d1_backup"` (manual) + **cron every ~6 days** export D1 → Cloudinary:
- `buzios/backups/d1-YYYY-MM-DD.json` (dated history)
- `buzios/d1-backup.json` (latest)
- `buzios/store.json` (emergency snapshot)  
Time Travel alone is only 7 days on Free — keep the Cloudinary snapshots. See `worker/SETUP-D1.md`.  
**Catalog:** Cloudinary only.

**Segurança / dados (staff):** Operational data is D1-primary. **Arquivar** is reversible status; **Lixeira** is soft-delete with 30-day recovery, then permanent purge on cron. **Apagar já** is irreversible in the UI (Time Travel / last backup only). Recommend Backup completo every few days. Same points appear in admin **Guia** and `BLUEPRINT.md` §2.2.

### 3. Admin password + named staff

Password exists **only** as Worker secret `ADMIN_PASSWORD` (`npx wrangler secret put ADMIN_PASSWORD`).  
It is **not** in `js/admin.js`. Login requires a **staff name** (dropdown) + password; POSTs `action: "auth"` and stores password + name in session for API calls / presence / audit.

**Force logout all devices:** Guia → “Terminar todas as sessões” (`force_logout_all`) bumps D1 `auth_epoch`. Open panels pick this up on the next presence heartbeat (~40s) and return to login. Hard reload alone does **not** end a session (password stays in `sessionStorage`).

### 4. Deploy static site

Cloudflare Pages → project root (folder with `index.html`).  
Push to GitHub or upload; **not** `wrangler deploy` from root.

### 5. Smoke test

```bash
# 1. Form write (public) — expect ok + id
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/submit" \
  -H "Content-Type: application/json" \
  -d '{"type":"contact","name":"Test","phone":"900000000","message":"ping"}'
# expect: {"ok":true,"id":"..."}

# 2. Auth
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ADMIN_PASSWORD","action":"auth"}'

# 3. Inbox from D1
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ADMIN_PASSWORD","action":"d1_get_submissions"}'

# 4. Optional backup
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ADMIN_PASSWORD","action":"d1_backup"}'
```

**Real form tests (public site):**

1. Open https://www.buzioshealthclub.com/contacto.html → submit a test contact → confirm in admin **Inscrições**.
2. Open https://www.buzioshealthclub.com/inscricao.html → submit a test enrollment → confirm in **Inscrições** + **Clientes** (new client if phone is new).
3. Newsletter field (if present on home/footer) → confirm under newsletter list in admin.
4. Change status of the test submission in admin → refresh → status persists (D1).
5. Optionally run `d1_backup` after tests.

Then:

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

| Data | Write | Admin read |
|------|-------|------------|
| Clients | **D1 only** (cutover) | **D1** (`d1_get_clients`) |
| Submissions / newsletter | **D1 only** (cutover) | **D1** (`d1_get_submissions` / `d1_get_newsletters`) |
| Catalog | Cloudinary only | Cloudinary via Worker `/catalog` |
| Ops backup | Cron (~6 days) + `d1_backup` → Cloudinary | `buzios/backups/d1-YYYY-MM-DD.json` + `d1-backup.json` + `store.json` |

1. Public forms → `POST /submit` → **D1** only (`WRITE_OPS_TO_STORE = false`)
2. Admin mutations (clients / inbox / newsletter) → **D1** only
3. Admin `loadStore()` reads Worker store snapshot (legacy) + optional Cloudinary (**8s** timeout), then **always overlays** clients + submissions + newsletters from D1. Snapshot `clients` are not rendered (avoids stale stats flash); UI waits for `d1_get_clients`.
4. All admin → Worker fetches (`/admin/data`, `/publish`, login, D1 overlays) use **`fetchWithTimeout` (12s)**. On timeout/network failure the sync pill shows **Sem ligação ao servidor** / **Servidor não respondeu** instead of hanging on “A sincronizar…”. Empty Clientes distinguishes load failure from a truly empty list.
5. Prefer newer `updatedAt`, then richness; **never** prefer empty over real data
6. `saveStore` **refuses** empty overwrite (still used if flag is re-enabled or by `d1_backup`)
7. **Backup** (Clientes → Backup) downloads full JSON; server-side `d1_backup` writes Cloudinary snapshots

`replace_store` ignores empty `clients` / `submissions` arrays unless `data._forceReplace === true` (recovery/import only).

**Gym / restrictive Wi‑Fi:** Static admin (Pages) can load while `*.workers.dev` is slow or blocked. Symptom: UI OK, Clientes empty, sync error after ~12s. Test `https://buzios-publish.gymngola.workers.dev/catalog` on that network; try hotspot if blocked.

### Site images

- Upload to Cloudinary with unsigned preset (or pick from media library)
- Assign to a slot → **Publicar na loja**
- Library alone does not update the public site

## Cloudinary assets

| Public ID | Written by | Read by |
|-----------|------------|---------|
| `buzios/catalog.json` | `POST /publish` | Worker `GET /catalog` → public + admin |
| `buzios/store.json` | Cron + `d1_backup` (and legacy dual-write if flag on) | Recovery / emergency snapshot |
| `buzios/d1-backup.json` | Cron + `d1_backup` | Always-latest full D1 export |
| `buzios/backups/d1-YYYY-MM-DD.json` | Cron + `d1_backup` | Dated history (beyond Time Travel window) |
| `buzios/store-prev.json` | `saveStore` (automatic, when ops write to store) | Recovery only |

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

**Client edit modal (sections):** Dados · Plano · Emergência · **Objectivos e notas** · Documentos · **Registar pagamento** · Histórico de treinos · Histórico do cliente · Histórico de pagamentos.  
- Objectivos e notas: **Objectivo de treino**, **Condições médicas**, **Notas internas** (separate fields).  
- Documentos: official slots BI / atestado / Foto 1 / Foto 2 / **Comprovativo de pagamento** (+ outros). Photo & document upload soft-refreshes media only (does not wipe unsaved form fields).  
- **Dirty-close:** × / backdrop / Escape warns if fields were edited; ignores async UI noise (no false alarm when only scrolling).  
- **Registar pagamento** (action block above históricos) — one of four modes on **Guardar cliente**:
  - **Só guardar dados** — no payment
  - **Só registar pagamento** — history + billing em dia; plan dates / membership unchanged
  - **Pagar e activar plano** — first payment / new membership: payment + plan dates (keep form dates if set, else today → today+cycle) + activo + em dia. Default when opening **Novo cliente**.
  - **Pagar e renovar plano** — extends plan end from current end (or today if expired/missing) + activo + em dia
- Payment history is a separate list (newest first). Histórico do cliente supports **+ Nota** (staff-attributed manual notes on `historyNotes`).

See `BLUEPRINT.md` for full workflow and data fields.

## Admin — Inscrições (summary)

Enrollment pipeline (reversible statuses):

**Novo → Contactado → Aguarda docs → Inscrito → Arquivar**

- **Criar cliente** — membership **activo**, submission **inscrito**
- **Criar pendente (docs)** — membership **pendente** until documents are complete
- **Arquivar** closes the ticket (does not delete the client in Clientes)
- **Restaurar cliente** when the linked client is in Lixeira (same record; inscrição status unchanged)
- Promote copies **goals** / **medicalConditions** / free-text **notes** as structured client fields (not one combined notes blob)
- Filters + bulk status actions; bulk selection survives list refresh — see `BLUEPRINT.md` §4.1

## Admin — live badges & alerts

- **Inscrições / Contactos** nav badges = count of status `novo`
- **Newsletter** badge = new signups since the panel was last opened
- **Clientes** badge = em dívida + expirados (unchanged)
- New rows toast during poll; optional browser notification if permission already granted and the tab is hidden

## Multi-device admin

Several staff devices can keep admin open:

- Store polled about every **60s** while the tab is focused, **~10 min** when hidden (tab return refreshes immediately)
- Presence (“X online”) **removed** — saved D1 reads; force-logout still works via auth epoch
- `trainings_summary` loads only on the **Treinos** panel (not on every Clientes open)
- Newer `store.updatedAt` wins; toast **Actualizado noutro dispositivo**
- Worker `update_client` re-loads store before write (reduces lost updates across devices)
- Same client edited at the same time → last write wins
- Bulk checkbox selection is kept in memory across poll re-renders

## Recent changes

### 2026-11-12 / 13 — Clientes load + “Pagar e activar”

- **Stale stats flash fixed:** server/Cloudinary `store.clients` is no longer painted into the Clientes list/stats (`deferClients` in `applyStore`). Hard reload shows “A carregar clientes…” until `d1_get_clients` returns.
- **Pagar e activar plano:** new payment mode for new clients / first payment (payment + plan dates + activo + em dia). Default when opening **Novo cliente**. Renew still extends from current end; “só registar” still leaves dates/membership alone.
- Details: `BLUEPRINT.md` (edit client modal + changelog).

### 2026-11-12 — Client modal (docs, goals, soft media, dirty-close) + Treinos reload

- **Objectivo de treino** / **Condições médicas** / **Notas internas** as separate fields (`goals`, `medicalConditions`, `notes`).
- **Documentos oficiais:** BI · atestado · Foto 1 · Foto 2 · **Comprovativo de pagamento**.
- Photo/document upload **does not reload** the whole client modal (preserves in-progress edits).
- **Dirty-close warning** on client modal (real edits only; no false positive from scroll / async loads).
- **Treinos:** after hard reload, date = today and the client list fills once D1 clients load.
- Earlier same day: Registar pagamento vs Histórico de pagamentos split; **+ Nota** on Histórico do cliente; payment list newest-first.
- Details: `BLUEPRINT.md` (edit client modal + §5.1 + changelog).

### 2026-11-11 — D1 read budget (presence removed)

- **Presence removed** entirely (UI + heartbeats + worker actions).
- **Poll:** focused ~60s / background ~10 min; refresh on tab focus still immediate.
- **authEpoch** returned on regular `get` so “Terminar todas as sessões” still logs others out within one poll.
- No trainings fetch on Clientes (only on Treinos).

### 2026-11-11 — D1 read budget + earlier fixes

- **D1 free-tier:** poll 30s / 90s; presence ~2.5 min; no trainings fetch on Clientes (only on Treinos). Avoids daily row-read limit exhaustion.
- **Restaurar cliente** from Inscrições when the linked client is in Lixeira; trash banner in client modal.
- Nav badges + toasts for new Inscrições, Contactos, Newsletter.
- Bulk selection no longer clears on list re-render (Inscrições / Contactos / Newsletter / Clientes).
- Client notes from enrollment: full labels, no duplicated Objectivos/Médicas/Notas lines. Redeploy Worker if auto-create notes path is still in use.

### 2026-11-09 — Treinos, client history, named admins, force logout

- **Public:** address updated (Rua 21-C … Rua do ginásio); Saturday hours 06h–12h on site.
- **Admin login:** staff name dropdown + shared password; presence shows who is online; audit detail prefixes `[Name]`.
- **Clientes:** accent-insensitive search; age filter; billing `desistente`; schedule 05:00; payment history edit/delete icons; documents upload/remove in edit modal.
- **Treinos panel:** attendance sessions in D1 (`0006_trainings.sql`); day/month counts; multi-session per day.
- **Histórico do cliente:** unified timeline (payments + trainings + audit) with year filter (`get_client_history`).
- **Force logout all:** Guia button → `force_logout_all` / `auth_epoch` (`0007_admin_settings.sql`).
- Deploy: `npx wrangler d1 migrations apply buzios-db --remote` then `npx wrangler deploy` from `worker/`; publish Pages for static UI.

### 2026-11-08 — Admin Worker timeouts + public form feedback

- Admin: **12s timeout** on all Worker fetches (`fetchWithTimeout`). Sync status becomes a visible error pill on hang/block (e.g. gym Wi‑Fi); Clientes empty state explains load failure.
- Sync status UI: pill badge (syncing pulse / ok / error) under section title.
- Public forms: native `alert()` removed — newsletter, contacto, and inscrição use **inline** success/error banners (`.form-feedback` / `.newsletter-feedback`).

### 2026-11-06 — Admin Guia + safety reminders

- Admin **Guia** tab: visible **Segurança / dados** block (D1 primary, Arquivar vs Lixeira 30d, permanent purge, backup cadence, Time Travel limits).
- Same points mirrored in `BLUEPRINT.md` §2.2 and this README (backup section).

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
- Auth: password only in Worker secret; login = staff name + password via `action: "auth"`; password in `sessionStorage` (`buzios_admin_pw`); name in `buzios_admin_name`; auth flag `buzios_admin_auth` (session + optional local “Manter sessão”). Hard reload does not log out.
- Force logout all devices: Guia → Terminar todas as sessões (`auth_epoch`)
- Sidebar: **Website**, **Instalar app**, **Sair**; panels include **Treinos**
- Client edit: payment history icons, document upload, **Histórico do cliente** timeline
- Keep `public_id` paths as `buzios/catalog.json` and `buzios/store.json` (with extension)
- After significant product/UX/infra changes: update **README.md** and **BLUEPRINT.md** in the same change set
- Deploy: **Pages** = static root; **Worker** = always `cd worker && npx wrangler deploy` (never from project root)
