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
         │                        ├─ Store write  → Cloudinary store.json + Workers Cache
         │                        │                 + store-prev.json; refuse empty overwrite
         │                        │                 + dual-write D1 (clients, submissions, newsletter)
         │                        ├─ Store read   → Cloudinary (newsletter); D1 for clients + inbox
         │                        └─ Prefer newer updatedAt, then richness; never empty over data
         └── admin dual-reads Cloudinary on first load; overlays clients + submissions from D1
Cloudinary
  ├─ buzios/catalog.json     (plans, texts, image slots)     ← long-term stay
  ├─ buzios/store.json       (newsletter read source; clients/inbox backup)
  ├─ buzios/store-prev.json  (last good store snapshot)
  └─ media (unsigned browser uploads)
Cloudflare D1 (buzios-db)    ← clients + inbox live (admin read); dual-write on all ops; newsletter read next
[Static HTML/CSS/JS] ◄── Cloudflare Pages
```

| Layer | Tech |
|-------|------|
| Static site | HTML / CSS / JS, Cloudflare Pages |
| API | Cloudflare Worker `buzios-publish` |
| Catalog (durable) | Cloudinary raw JSON + image assets |
| Operational data | **Clients + inbox:** D1 (admin read + dual-write). **Newsletter:** dual-write; admin still reads Cloudinary. **Catalog:** Cloudinary |
| Ephemeral draft | Admin `localStorage` (catalog only, dirty flag) |
| Comms / payments | WhatsApp + bank IBAN (no payment gateway) |

**Data split (intentional):**

| Data | Storage | Why |
|------|---------|-----|
| Plans, site texts, image slots | Cloudinary JSON | Rare writes; public site needs a simple file |
| Clients | D1 (admin read + dual-write) | Daily edits; row-level; no whole-file races |
| Inscrições / contactos (inbox) | D1 (admin read + dual-write) | Status updates without depending on Cloudinary file |
| Newsletter | Dual-write D1 + Cloudinary; admin still reads Cloudinary | Same pattern; short next phase |

Worker base: `https://buzios-publish.gymngola.workers.dev`

| Route | Who | Role |
|-------|-----|------|
| `GET /catalog` | Public + admin | Fresh catalog (bypass CDN) |
| `POST /submit` | Public | Enrollment, contact, newsletter |
| `POST /publish` | Admin | Write catalog |
| `POST /admin/data` | Admin | Read/update store + D1 ops (`d1_status`, `d1_import_from_store`, `d1_get_clients`, `d1_get_submissions`) |

D1 setup: `worker/SETUP-D1.md`. Details and secrets: `README.md`.

### 2.1 Store durability rules (2026-11-06)

- **Never** use `fetch(url, { cache: 'no-store' })` inside the Worker — Cloudflare Workers throws; Cloudinary reads look empty. Bust with `?_=…` only.
- `saveStore` refuses to write an empty store over a non-empty one; writes `store-prev.json` before the main file.
- Admin `applyStore` blocks empty remote overwriting a non-empty local client list.
- `replace_store` ignores empty arrays unless `_forceReplace: true`.
- Prefer newer `updatedAt`, then record count; never prefer empty over real data.

---

## 3. Public pages

| Page | Role |
|------|------|
| `index.html` | Home — hero, intro, services, plans teaser |
| `ginasio.html` | Gym |
| `natacao.html` | Swimming school |
| `planos.html` | All plans & prices |
| `inscricao.html` | Enrollment form → store |
| `contacto.html` | Contact form → store |
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
| Planos | Catalog products/prices → publish |
| Imagens | Slots + media library → publish |
| Textos | Site copy → publish |
| Guia | In-app staff help |

- Only Planos / Imagens / Textos need **Publicar no website**.
- Clientes / inscrições / contactos / newsletter persist via `/admin/data` automatically.
- Nav badge on Clientes when debt + expired count > 0.
- Active panel remembered in `sessionStorage`.
- **Session:** `sessionStorage` / `localStorage` (`buzios_admin_auth`). Reload does not flash login when already authed (`html.admin-authed` set in `<head>`).
- **Multi-device sync:** while admin is open, store is polled ~every 7s (and on tab focus). Newer `updatedAt` replaces local store; toast “Actualizado noutro dispositivo”. Writes pause polling briefly.

**Admin chrome**

- Login: logo + “Búzios Admin”
- Sidebar brand: logo (+ text on wide nav)
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

### Client data (store)

Typical fields: `id`, `name`, `phone`, `email`, `area`, `memberNumber`, `age`, `schedule`, `hasCard` (`""` | `"sim"` | `"nao"`), `planName` / `planId`, `price`, `billingCycle`, `planStart`, `planEnd`, `membershipStatus`, `billingStatus`, `emergencyName`, `emergencyPhone`, `notes`, `payments[]`, `lastPaymentAt`, `createdAt`, `fromSubmission`, `fromImport`, `archivedAt`.

Edit modal exposes Nº sócio, idade, horário (select) and cartão as first-class fields. Legacy notes dumps (`Nº · Horário · Cartão · Idade`) are parsed on open when structured keys are missing; cleaned remainder stays in Notas.

---

## 6. Data model (high level)

### Catalog (`buzios/catalog.json`)

Plans, site texts, image slot URLs — edited in admin, published explicitly.

### Store (`buzios/store.json`)

- `submissions` — inscrição + contacto
- `clients` — membership records (cap **3000** in Worker)
- `newsletters` — phone opt-ins
- `updatedAt` — ISO timestamp on every write

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
Address: Rua 21-c, travessa 5, Bairro do Benfica, Kifica nº 57-59, Luanda  
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
| `worker/SETUP-D1.md` | D1 create / migrate / import commands |
| `icons/logo.png` | Brand mark |

---

## 9. Change log (blueprint)

### 2026-11-06

- **Empty Clientes bug:** Worker `fetch` with `{ cache: 'no-store' }` throws on CF Workers → Cloudinary load failed → intermittent 0 clients. Removed; query-string cache-bust only.
- **Store guards:** refuse empty `saveStore`; auto `store-prev.json`; admin blocks empty remote over non-empty local list.
- **Architecture decision:** catalog stays Cloudinary JSON; operational data moves to **Cloudflare D1**. Supabase reserved for multi-tenant Pro product later.
- **D1 live:** schema + import (263 clients); admin **reads clients from D1**; dual-write clients/submissions/newsletter on `/submit` and admin mutations. Inbox **read** still Cloudinary. See `worker/SETUP-D1.md`.

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
