# Búzios Health Club — Blueprint

Product and architecture blueprint for the public site and staff admin.

**Rule:** Update this file **and** `README.md` on every significant or important change (features, data model, brand, deploy, UX workflows).

---

## 1. Purpose

- **Public site:** brochure + enrollment/contact for Búzios Health Club (ginásio + escola de natação) in Kifica, Luanda.
- **Admin:** password-gated staff panel for leads, clients/membership, plans, site images/texts, and publishing.

Live: https://www.buzioshealthclub.com

---

## 2. System architecture

```
[Browser public pages] ──POST /submit──► [Cloudflare Worker]
[Browser admin.html]  ──POST /admin/data /publish──► [Worker]
         │                        │
         │                        ├─ Catalog write → Cloudinary catalog.json (+ invalidate)
         │                        ├─ Ops write    → D1 only (clients, submissions, newsletter)
         │                        ├─ Ops backup   → cron (~6d) + d1_backup
         │                        │                 → backups/d1-YYYY-MM-DD.json
         │                        │                 → d1-backup.json + store.json
         │                        └─ Ops read     → D1 (admin overlays after load)
         └── admin login via action "auth" (password = Worker secret only)
Cloudinary
  ├─ buzios/catalog.json              (plans, texts, image slots)  ← long-term stay
  ├─ buzios/backups/d1-YYYY-MM-DD.json (dated ops history, cron)
  ├─ buzios/d1-backup.json            (always-latest D1 export)
  ├─ buzios/store.json                (emergency snapshot via backup)
  ├─ buzios/store-prev.json           (last good store snapshot)
  └─ media (unsigned browser uploads)
Cloudflare D1 (buzios-db)    ← clients + inbox + newsletter (primary)
[Static HTML/CSS/JS] ◄── Cloudflare Pages
```

| Layer | Tech |
|-------|------|
| Static site | HTML / CSS / JS, Cloudflare Pages |
| API | Cloudflare Worker `buzios-publish` |
| Catalog (durable) | Cloudinary raw JSON + image assets |
| Operational data | **Clients + inbox + newsletter:** D1 only (cutover 2026-11-06). **Catalog:** Cloudinary |
| Ephemeral draft | Admin `localStorage` (catalog only, dirty flag) |
| Comms / payments | WhatsApp + bank IBAN (no payment gateway) |

**Data split (intentional):**

| Data | Storage | Why |
|------|---------|-----|
| Plans, site texts, image slots | Cloudinary JSON | Rare writes; public site needs a simple file |
| Clients | D1 only | Daily edits; row-level; no whole-file races |
| Inscrições / contactos (inbox) | D1 only | Status updates without Cloudinary file |
| Newsletter | D1 only | Same pattern as inbox |
| Ops backup | Cloudinary dated `backups/d1-YYYY-MM-DD.json` + latest pointers | Cron every ~6 days + on-demand `d1_backup` |

Worker base: `https://buzios-publish.gymngola.workers.dev`

| Route | Who | Role |
|-------|-----|------|
| `GET /catalog` | Public + admin | Fresh catalog (bypass CDN) |
| `POST /submit` | Public | Enrollment, contact, newsletter → D1 |
| `POST /publish` | Admin | Write catalog |
| `POST /admin/data` | Admin | Auth, D1 ops, legacy store (`auth`, `d1_status`, `d1_import_from_store`, `d1_get_*`, `d1_backup`, mutations) |

D1 setup: `worker/SETUP-D1.md`. Details and secrets: `README.md`.

**Cutover (2026-11-06):** `WRITE_OPS_TO_STORE = false` in Worker. Mutations skip `store.json`. Admin password is only the Worker secret (login via `action: "auth"`).

### 2.1 Store durability rules (2026-11-06)

- **Never** use `fetch(url, { cache: 'no-store' })` inside the Worker — Cloudflare Workers throws; Cloudinary reads look empty. Bust with `?_=…` only.
- `saveStore` refuses to write an empty store over a non-empty one; writes `store-prev.json` before the main file.
- Admin `applyStore` blocks empty remote overwriting a non-empty local client list.
- `replace_store` ignores empty arrays unless `_forceReplace: true`.
- Prefer newer `updatedAt`, then record count; never prefer empty over real data.
- After cutover, operational writes do not call `saveStore`; use `d1_backup` for Cloudinary snapshots.
- **Admin browser → Worker:** all `/admin/data`, `/publish`, and login calls use **`fetchWithTimeout` (12s)** in `js/admin.js`. Cloudinary store snapshot fetch stays at **8s**. Timeouts surface as sync error (“Sem ligação ao servidor” / “Servidor não respondeu”), not endless “A sincronizar…”.
- **Restrictive networks:** Pages static UI can load while `buzios-publish.*.workers.dev` is blocked — Clientes stays empty until the Worker is reachable (try hotspot; open `/catalog` as a smoke test).

### 2.2 Segurança / dados (staff)

Mirrored in admin **Guia** tab. Keep UI and docs in sync.

- Operational data (clients, submissions, newsletter) lives in **Cloudflare D1**, not only Cloudinary.
- **Arquivar** ≠ delete: record leaves the daily queue and can be reactivated. **Lixeira** sets `deleted_at` (soft, recoverable **30 days**); cron permanently purges after 30 days. Migration `0002_trash.sql`.
- **Apagar já / permanent purge** is irreversible in the panel (recovery only via D1 Time Travel or last Cloudinary backup).
- Recommend: run **Backup completo** (or wait for scheduled `d1_backup`) at least every few days.
- D1 Time Travel: **7 days** (Free) / **30 days** (Paid). Long-term copies: `buzios/backups/d1-YYYY-MM-DD.json` + `d1-backup.json` on Cloudinary.

---

## 3. Public pages

| Page | Role |
|------|------|
| `index.html` | Home — hero, intro, services, plans teaser |
| `ginasio.html` | Gym |
| `natacao.html` | Swimming school |
| `planos.html` | All plans & prices |
| `inscricao.html` | Enrollment form → Worker `/submit` → D1 |
| `contacto.html` | Contact form → Worker `/submit` → D1 |
| PWA | `manifest.json` + `sw.js` + `/icons/` |

**Brand on every public page**

- Header: logo (`icons/logo.png`) + “Búzios / Health Club”
- Mobile drawer: same
- Footer: logo + © Búzios Health Club · La Casa de Ferro

---

## 4. Admin panel (`admin.html`)

Password gate → sections:

| Panel | Function |
|-------|----------|
| Inscrições | Enrollment submissions; promote to client (see §4.1) |
| Contactos | Contact form messages |
| Newsletter | Phone list |
| **Clientes** | Membership CRM (see §5) |
| **Treinos** | Attendance: mark sessions, day/month counts (see §5.1) |
| Planos | Catalog products/prices → publish |
| Imagens | Slots + media library → publish |
| Textos | Site copy → publish |
| Histórico | Global audit log |
| Guia | In-app staff help + force logout all devices |

- Only Planos / Imagens / Textos need **Publicar no website**.
- Clientes / inscrições / contactos / newsletter / treinos persist via `/admin/data` → **D1** automatically.
- Nav badge on Clientes when debt + expired count > 0.
- Active panel remembered in `sessionStorage`.
- **Session:** login requires **staff name** (dropdown) + shared Worker secret password (`action: "auth"`). Names: Julio Figueiredo, Nataniel Figueiredo, Keuria, Garcia Kissanga, Amarildo Salvador. Auth flag `buzios_admin_auth`; password in `sessionStorage` (`buzios_admin_pw`); name in session/local (`buzios_admin_name`). Hard reload does **not** clear the session. **Sair** clears password + flags. **Guia → Terminar todas as sessões** bumps D1 `auth_epoch` so every open panel logs out within ~40s (presence heartbeat).
- **Presence:** sidebar/meta shows who is online by name (last ~2 min).
- **Multi-device sync:** while admin is open, store is polled on an interval (and on tab focus). D1 overlays refresh clients / inbox / newsletter. Writes pause polling briefly.

**Admin chrome**

- Login: logo + “Búzios Admin” + name select + password
- Sidebar brand: logo (+ text on wide nav)
- Bar meta: current user · sync status · who is online
- Sidebar footer actions: **Website** (opens public site), **Instalar app**, **Sair**
- Icons: `icons/admin-192.png`, `admin-512.png` (from same logo artwork)

### 4.1 Inscrições workflow

Suggested path: **Novo → Contactado → Aguarda docs → Inscrito**, then **Arquivar** so the active queue stays clean.

| Status | Meaning |
|--------|---------|
| `novo` | Just submitted |
| `contactado` | Staff contacted the person |
| `pendente_docs` | Waiting for documents (BI, medical, photos) |
| `inscrito` | Converted / marked enrolled |
| `arquivado` | Closed ticket (history only) |

- Statuses are **reversible** (e.g. back to Novo).
- Filters + bulk actions for each status.
- **Criar cliente** → client `membershipStatus: activo`, submission → `inscrito`, linked via `fromClientId`.
- **Criar pendente (docs)** → client `membershipStatus: pendente`, submission → `pendente_docs`.
- **Ver cliente** when already linked.
- **Arquivar** removes from the daily queue; does **not** delete the client in Clientes.
- **Apagar** deletes only the enrollment submission.

---

## 5. Clientes workflow (staff UX)

Designed for daily membership ops: who is active, who expires soon, who owes.

### Layout

1. Page head — description + **Backup** · Exportar CSV · Copiar telefones · **+ Cliente**
2. **Sticky strip**
   - Status counts: Activos · A expirar (7d) · Expirados · Em dívida · Pendentes (coloured underline)
   - Search + sort
   - Filter pills: Todos / Activos / A expirar / Expirados / Em dívida / Pendentes / Suspensos / Arquivados
3. Top bulk bar (select all + actions when list non-empty)
4. **Dense rows** (not large cards)
5. Floating bulk bar when ≥1 row selected

### Row content

| Column | Content |
|--------|---------|
| Checkbox | Bulk select |
| Main | Name (click → edit), membership + billing badges, phone · email · área |
| Plan | Plan name, price, cycle |
| Period | Start → end + **days-left pill** (green / amber / red) |
| Actions | Renovar, WhatsApp emphasised when debt/expiring; Editar; **Mais** menu |

**Mais** menu: Editar, Suspender/Reactivar, Arquivar, Apagar.  
Closes on **outside click** or **Escape**.

### Behaviour

- **Default sort:** priority (dívida → a expirar → pendente → rest), then plan end ascending
- Status derived from `planEnd` via `enrichClient()`:
  - Auto-sets **expirado** when `planEnd` is past (unless suspenso / cancelado / arquivado / pendente / isento)
  - Explicit **expirado** from the form is **kept**; if `planEnd` is still future/empty, it is backdated to yesterday so derived state matches
  - Does **not** force expirado → activo when the staff chose expirado
- Empty filter → message + **Limpar filtros**
- Bulk: WhatsApp (copy phones + open first), Suspender, Arquivar, Exportar selected, Apagar
- **Backup**: downloads full JSON (`store` + `catalog`) — use before bulk delete or re-import
- Export CSV / Copiar telefones use **selection** if any, else current filtered list
- Shortcuts (Clientes panel only, not while typing): `/` → search, `N` → new client
- Quick **Renovar**: extends period by billing cycle, records payment, sets activo / em_dia
- **Worker `update_client`:** re-loads store immediately before applying the patch (reduces multi-staff lost updates on *other* clients; same-client last-write still wins)

### Client data (store / D1)

Typical fields: `id`, `name`, `phone`, `email`, `area`, `memberNumber`, `age`, `schedule`, `hasCard` (`""` | `"sim"` | `"nao"`), `planName` / `planId`, `price`, `billingCycle`, `planStart`, `planEnd`, `membershipStatus`, `billingStatus` (includes **`desistente`**), `emergencyName`, `emergencyPhone`, `notes`, `payments[]`, `attachments` / `documents`, `lastPaymentAt`, `createdAt`, `fromSubmission`, `fromImport`, `archivedAt`.

Edit modal exposes Nº sócio, idade, horário (select includes **05:00**), cartão, payment history (edit/delete icons), document upload/remove, and **Histórico do cliente** (unified timeline).

**Client list:** search is accent-insensitive; filters include status pills + **Filtrar por idade** (ranges / sem idade).

Legacy notes dumps (`Nº · Horário · Cartão · Idade`) are parsed on open when structured keys are missing; cleaned remainder stays in Notas.

### 5.1 Treinos + Histórico do cliente

- **Treinos panel:** date picker, search, filter (activos / todos / só quem treinou no dia). **+ Treino** registers a session (multiple per day allowed). Counts for day and month. `recorded_by` = admin name.
- **D1 `trainings`:** `id`, `client_id`, `trained_at`, `trained_date`, `recorded_by`, `note`, `created_at`.
- **Histórico do cliente** (edit modal): one timeline of payments + trainings + audit events + “cliente criado”; year filter; summary counts. Worker `get_client_history`.

---

## 6. Data model (high level)

### Catalog (`buzios/catalog.json`)

Plans, site texts, image slot URLs — edited in admin, published explicitly.

### Operational data (D1 primary)

| Table / data | Role |
|--------------|------|
| `clients` | Membership CRM |
| `submissions` | Inscrição + contacto inbox |
| `newsletters` | Phone opt-ins |
| `audit_log` | Write log (actions include `[AdminName]` in detail when known) |
| `admin_presence` | Who has the panel open (+ `admin_name`) |
| `trainings` | Attendance sessions |
| `admin_settings` | e.g. `auth_epoch` for force logout all |

Legacy Cloudinary `store.json` remains for backups / emergency snapshot only (`WRITE_OPS_TO_STORE = false`).

Public `POST /submit` appends; admin mutates via `POST /admin/data`.

**Write order:** Cloudinary signed upload (`invalidate=true`) → Workers Cache.  
**Read order:** Cloudinary delivery (cache-busted) vs Workers Cache → prefer richer / newer; backfill cache when Cloudinary wins.  
**Admin:** also loads Cloudinary delivery directly and keeps the richer snapshot (guards against stale colo cache).  
**Replace safety:** `replace_store` ignores empty client/submission arrays unless `_forceReplace: true`.  
**Backup:** Clientes → Backup → `buzios-backup-YYYY-MM-DD.json` (store + catalog).

---

## 7. Brand & visual

| Item | Value |
|------|--------|
| Primary name | Búzios / Health Club |
| Secondary | La Casa de Ferro · Escola de Natação Búzios |
| Logo file | `icons/logo.png` (source `logo.jpg`; circular mark) |
| Accent | Terracotta `#c45c26` |
| Public type | Montserrat (display/brand, matches logo) + Inter (body) |
| Admin type | Inter |
| Language | Portuguese first |

WhatsApp: ginásio +244 923 423 142 · natação +244 929 208 317  
IBAN: A006 0040 0000 6810 2585 1017 3  
Address: Rua 21-C, travessa 5, nº 57-59, Bairro do Benfica · Kifica (Rua do ginásio), Luanda  
(Maps button uses business-name search so the Google place panel stays reliable)

---

## 8. Key source files

| Path | Role |
|------|------|
| `admin.html` | Admin shell + panels markup |
| `js/admin.js` | Admin logic, clients CRM, bulk, publish, store guards |
| `css/admin.css` | Admin layout & Clientes dense UI |
| `css/styles.css` | Public site + brand logo layout |
| `js/app.js` / `js/products.js` | Public behaviour / catalog |
| `worker/src/index.js` | API (Cloudinary store + D1 helpers) |
| `worker/wrangler.toml` | Worker + D1 binding |
| `worker/migrations/0001_init.sql` | D1 schema (clients, submissions, newsletters, audit_log) |
| `worker/migrations/0002_trash.sql` | `deleted_at` for 30-day trash |
| `worker/migrations/0004_admin_presence.sql` | Open-panel presence |
| `worker/migrations/0005_admin_name.sql` | `admin_name` on presence |
| `worker/migrations/0006_trainings.sql` | Attendance / trainings |
| `worker/migrations/0007_admin_settings.sql` | `auth_epoch` (force logout) |
| `worker/SETUP-D1.md` | D1 create / migrate / import commands |
| `icons/logo.png` | Brand mark |

---

## 9. Change log (blueprint)

### 2026-11-09

- **Address updated** site-wide to: Rua 21-C, travessa 5, nº 57-59, Bairro do Benfica · Kifica (Rua do ginásio).
- **Saturday hours** added on public pages: Sábados 06h–12h (Domingos & feriados text unchanged).
- **Admin schedule**: 05:00 option added (special PT sessions).
- **Billing status**: new value `desistente` (protected from auto planEnd overwrite).
- **Search**: accent-insensitive (José ≈ Jose, ç ≈ c) on Clientes.
- **Client edit modal**: always scrolls to top when opened.
- **Histórico de pagamentos**: each line has pencil (edit) and trash (delete) icon buttons. Edit uses simple prompts for amount / method / note; delete confirms then saves.
- **Named admin logins**: login requires selecting a staff name (Julio Figueiredo, Nataniel Figueiredo, Keuria, Garcia Kissanga, Amarildo Salvador) + shared password. Name is stored in session, shown in the admin bar, sent with presence heartbeats and mutations. Presence shows who is online by name. Client/submission saves record `[Name]` in audit_log detail. Migration `0005_admin_name.sql`.
- **Treinos (attendance)**: new admin panel to mark training sessions. D1 table `trainings` (migration `0006_trainings.sql`). Any admin can add multiple sessions per day; counts for day/month; sessions show who recorded them; client edit modal shows recent training history + “Marcar treino de hoje”. Worker actions: `add_training`, `delete_training`, `list_trainings`, `trainings_summary`.
- **Filtrar por idade**: age range select on Clientes toolbar (`<18`, 18–25, 26–35, 36–50, 51+, sem idade).
- **Client documents in edit panel**: upload images/PDFs via Cloudinary from client modal (`+ Adicionar`); remove with trash icon; stored on client `attachments` (and clears matching `documents` / `paymentProof` URLs on delete).
- **Force logout all devices**: Guia → “Terminar todas as sessões”. Bumps D1 `admin_settings.auth_epoch` (migration `0007_admin_settings.sql`); presence heartbeats detect the new epoch and log every open panel out within ~40s. Explains why hard reload alone does not clear the session (password lives in `sessionStorage`).
- **Histórico do cliente**: unified timeline in client edit modal — payments + trainings + audit/status events + “cliente criado”, with year filter and summary counts. Worker action `get_client_history` (trainings + audit for client).

### 2026-11-08

- **Hero density on laptops:** tighter vertical rhythm + slightly wider title (`max-width: 18–20ch`) for viewports ≤920px tall so the hero text no longer feels crowded on common Lenovo / 14″ screens. Tall desktops keep the previous spacious treatment (85vh + larger type). Sub-page heroes (Ginásio / Natação) moved from inline `min-height:70vh` to class `.hero--page` so the same laptop rules apply (full-bleed + compact text on short screens, ~70–72vh on tall).
- **Worker fetch timeouts (admin):** `fetchWithTimeout` 12s on login, `loadStore`, D1 overlays, mutations, publish. Sync pill + Clientes empty state distinguish network failure from empty data (gym Wi‑Fi case).
- **Public form UX:** no native `alert()` — inline feedback on newsletter (home), contacto, inscrição. Success panels unchanged where they already existed.
- **Sync status visibility:** pill badge styles for syncing / ok / error under admin section title.

### 2026-11-06

- **Admin Guia + safety:** Guia tab **Segurança / dados** block; docs §2.2 + README backup note (D1, Arquivar vs Lixeira 30d, purge, backup cadence, Time Travel).
- **Empty Clientes bug:** Worker `fetch` with `{ cache: 'no-store' }` throws on CF Workers → Cloudinary load failed → intermittent 0 clients. Removed; query-string cache-bust only.
- **Store guards:** refuse empty `saveStore`; auto `store-prev.json`; admin blocks empty remote over non-empty local list.
- **Architecture decision:** catalog stays Cloudinary JSON; operational data moves to **Cloudflare D1**. Supabase reserved for multi-tenant Pro product later.
- **D1 live:** schema + import (263 clients); admin reads clients + inbox + newsletter from D1.
- **Cutover:** `WRITE_OPS_TO_STORE = false` — mutations and `/submit` write **D1 only**. `d1_backup` exports to Cloudinary.
- **Password out of code:** admin login via Worker `action: "auth"`; no hardcoded password in `js/admin.js`.
- **Admin load hardening:** Cloudinary store fetch 8s timeout; always overlay clients/submissions/newsletters from D1 so Clientes cannot stay empty if store snapshot stalls.
- **Admin chrome:** sidebar **Website** (public site), **Sair** (logout clears session password + auth).
- **Scheduled ops backup:** Worker cron `0 3 1,7,13,19,25 * *` (~every 6 days, 03:00 UTC) runs `d1BackupToCloudinary`. Writes `buzios/backups/d1-YYYY-MM-DD.json` (dated history) + `d1-backup.json` + `store.json`. Complements D1 Time Travel (7d Free / 30d Paid). Docs: `SETUP-D1.md`, README, this blueprint.
- **/submit fail-loud:** After cutover D1 is primary. If DB is unbound or any upsert throws, `/submit` returns 5xx (never silent `{ok:true}`). Public forms check `res.ok` and show **inline** error feedback (not `alert()`).
- **D1 batch + retries:** Multi-row writes (enrollment submission+client, delete+audit) use `DB.batch()` as one transaction. Transient errors (network lost, DO reset, SQLITE_BUSY, overloaded) retry up to 3× with exponential backoff + jitter. Platform only auto-retries reads.
- **30-day trash:** “Apagar/Lixeira” sets `deleted_at` (soft). Filter **Lixeira (30d)** + Restaurar. Permanent purge after 30 days on backup cron. Migration `0002_trash.sql`. Arquivar remains separate.

### 2026-11-04 → 2026-11-05

- Clientes page: dense rows, sticky summary/filters, priority actions, floating bulk bar, bulk WhatsApp/export, keyboard shortcuts, **Mais** closes on outside click / Escape
- Brand logo rolled out site-wide (header, drawer, footer, admin nav, login) and into PWA icons
- Google SERP favicon: root `favicon.ico` + sized PNGs (`favicon-48/96/192`), schema.org `logo`, solid-background icons for clarity at small sizes
- Typography: switched display font from Cormorant Garamond to **Montserrat** (geometric, aligned with La Casa de Ferro logo lettering); Inter kept for body
- Documentation rule: keep **README.md** + **BLUEPRINT.md** updated on every significant change
- **Store clients cap** raised 500 → **3000** in Worker (`worker/src/index.js`); redeploy required
- Excel membership import (~264 clients): `import-clients.json` + `import-clients-payload.json` + `IMPORT.md`
- **Store durability fix:** Cloudinary-first writes; delivery-URL reads as source of truth; admin dual-read fallback; `debug_store` action for ops
- **Backup** button on Clientes — full JSON export (store + catalog)
- **replace_store** does not wipe lists with `[]` unless `_forceReplace: true`
- Client edit: structured **Nº sócio**, **Idade**, **Horário**, **Cartão** fields; legacy notes parse on open; list shows Nº / horário / cartão; CSV columns updated

### 2026-11-05 (later)

- **Import notes cleanup:** removed `Import Excel (X meses) · planEnd provisório…` from all 264 clients; filled `schedule` / `hasCard` / `age` from legacy notes (see `IMPORT.md`)
- **Client save / Expirado:** explicit Expirado from form is kept; future `planEnd` backdated to yesterday; `pendente` not auto-flipped by plan dates
- **Inscrições:** reversible statuses; new `pendente_docs`; filters + bulk; **Criar cliente** vs **Criar pendente (docs)**; Arquivar closes the ticket without deleting the client
- **Multi-device admin sync:** poll store ~7s + on tab focus; prefer newer `updatedAt`
- **Worker:** `update_client` re-loads store before write (multi-staff safety)
- **Login flash:** early `admin-authed` class so reload does not show login when session is valid
- **Public mobile:** tighter layout for ≤600px / ≤380px (iPhone 6s-class); SW `buzios-v3` network-first for HTML/JS/CSS

---

*When this blueprint diverges from the running site, treat the code as source of truth and update this file in the same change set.*
