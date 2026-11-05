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
         │                        ├─ Cloudinary first on write (durable + CDN invalidate)
         │                        ├─ Workers Cache second (per-colo fast path)
         │                        └─ Read: Cloudinary delivery (source of truth) vs cache → richer wins
         └── also GET res.cloudinary.com/…/buzios/store.json (admin fallback if Worker thin)
Cloudinary
  ├─ buzios/store.json   (inbox, clients, newsletter)
  ├─ buzios/catalog.json (plans, texts, image slots)
  └─ media (unsigned browser uploads)
[Static HTML/CSS/JS] ◄── Cloudflare Pages
```

| Layer | Tech |
|-------|------|
| Static site | HTML / CSS / JS, Cloudflare Pages |
| API | Cloudflare Worker `buzios-publish` |
| Durable data | Cloudinary raw JSON + image assets |
| Ephemeral draft | Admin `localStorage` (catalog only, dirty flag) |
| Comms / payments | WhatsApp + bank IBAN (no payment gateway) |

Worker base: `https://buzios-publish.gymngola.workers.dev`

| Route | Who | Role |
|-------|-----|------|
| `GET /catalog` | Public + admin | Fresh catalog (bypass CDN) |
| `POST /submit` | Public | Enrollment, contact, newsletter |
| `POST /publish` | Admin | Write catalog |
| `POST /admin/data` | Admin | Read/update store |

Details and secrets: see `README.md`.

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
| Inscrições | Enrollment submissions; promote to client |
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

**Admin chrome**

- Login: logo + “Búzios Admin”
- Sidebar brand: logo (+ text on wide nav)
- Icons: `icons/admin-192.png`, `admin-512.png` (from same logo artwork)

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
- Status derived from `planEnd` via `enrichClient()` (respects suspenso / cancelado / arquivado / isento)
- Empty filter → message + **Limpar filtros**
- Bulk: WhatsApp (copy phones + open first), Suspender, Arquivar, Exportar selected, Apagar
- **Backup**: downloads full JSON (`store` + `catalog`) — use before bulk delete or re-import
- Export CSV / Copiar telefones use **selection** if any, else current filtered list
- Shortcuts (Clientes panel only, not while typing): `/` → search, `N` → new client
- Quick **Renovar**: extends period by billing cycle, records payment, sets activo / em_dia

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
| `js/admin.js` | Admin logic, clients CRM, bulk, publish |
| `css/admin.css` | Admin layout & Clientes dense UI |
| `css/styles.css` | Public site + brand logo layout |
| `js/app.js` / `js/products.js` | Public behaviour / catalog |
| `worker/src/index.js` | API |
| `icons/logo.png` | Brand mark |

---

## 9. Change log (blueprint)

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

---

*When this blueprint diverges from the running site, treat the code as source of truth and update this file in the same change set.*
