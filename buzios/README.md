# Búzios Health Club — Website

Luxury mobile-first brochure + admin site for **Búzios Health Club / Escola de Natação Búzios** (Luanda).

## Stack

- Pure HTML / CSS / JS (no build step)
- Cloudflare Pages (static)
- Cloudflare Worker (publish + form submissions + admin store)
- Cloudinary
  - **Unsigned** preset for browser image/doc uploads
  - **Signed** raw upload (Worker) for `catalog.json` and `store.json`
- localStorage (admin drafts / same-browser preview)

## Pages

| File | Description |
|------|-------------|
| `index.html` | Home — hero, about, services, plans teaser |
| `ginasio.html` | Gym equipment & plans |
| `natacao.html` | Swimming school |
| `planos.html` | All plans & prices |
| `inscricao.html` | Enrollment form |
| `contacto.html` | Contact form |
| `admin.html` | Staff panel (password-gated) |

## Setup checklist

1. **Cloudinary**
   - Cloud name: `ogtzpc3v` (already set in client JS)
   - Create an **unsigned** upload preset named `buzios_unsigned` (folder: `buzios`)
   - Use an API key with **upload/create** permission (Root key, or a key with Master Admin role)
   - API key + secret go **only** into the Worker secrets (never in the browser)

2. **Worker** (required for forms, publish, and admin inbox)
   ```bash
   cd worker
   npx wrangler deploy
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put CLOUDINARY_CLOUD_NAME   # ogtzpc3v
   npx wrangler secret put CLOUDINARY_API_KEY      # key with create permission
   npx wrangler secret put CLOUDINARY_API_SECRET   # matching secret, no trailing spaces
   ```
   Live base URL: `https://buzios-publish.gymngola.workers.dev`

   | Route | Purpose |
   |-------|---------|
   | `POST /submit` | Public — enrollment, contact, newsletter |
   | `POST /publish` | Admin — write `buzios/catalog.json` |
   | `POST /admin/data` | Admin — read/update `buzios/store.json` |

   After any change to `worker/src/index.js`, run `npx wrangler deploy` again.

3. **Admin password**  
   Default in `js/admin.js`: `buzios2026` — **change after handoff** (and set the same value as Worker `ADMIN_PASSWORD`).

4. **Deploy static site**  
   Point Cloudflare Pages (or any static host) at the project root (folder containing `index.html`).

5. **Smoke test**
   - Contact form → success alert → Admin → **Inscrições** shows type Contacto
   - Enrollment form → success box → appears in Inscrições + Clientes
   - Admin → login → upload image → assign to Hero → **Publicar na loja**
   - Hard-refresh public site (catalog loads from Cloudinary)
   - Optional CLI:
     ```bash
     curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/submit" \
       -H "Content-Type: application/json" \
       -d '{"type":"contact","name":"Test","phone":"900000000","message":"ping"}'
     # expect: {"ok":true,"id":"..."}
     ```

## Cloudinary assets (Worker)

| Public ID | Written by | Read by |
|-----------|------------|---------|
| `buzios/catalog.json` | `POST /publish` | Public site (`js/app.js`) |
| `buzios/store.json` | `POST /submit`, `POST /admin/data` | Admin inbox / clients |

Signed raw upload must include `overwrite=true` in the signature string (alphabetical params + API secret). Client image uploads use the unsigned preset only.

**Permissions:** If the Worker returns `missing permissions (actions=["create"])`, the API key is restricted — use Root or assign Master Admin to that key.

**Invalid Signature:** Almost always a mismatched key/secret pair or a trailing newline in `CLOUDINARY_API_SECRET`. Re-run `wrangler secret put` with the exact secret from Cloudinary.

## Brand

- Name: **Búzios** / Health Club  
- Secondary: La Casa de Ferro / Escola de Natação Búzios  
- WhatsApp ginásio: +244 923 423 142  
- WhatsApp natação: +244 929 208 317  
- IBAN: A006 0040 0000 6810 2585 1017 3  
- Address: Rua 21-c, Bairro do Benfica, Kifica nº 57-59, Luanda

## Visual system

- **Quiet luxury** — warmer paper background, terracotta accent, soft elevation
- Type pairing: **Cormorant Garamond** (display / titles) + **Inter** (body / UI)
- Thin borders, generous whitespace, light type (300–500)
- Cards radius 16px, soft shadow + lift on hover
- Transparent header over hero → solid + blur on scroll
- Accent underline under section titles
- Scroll-reveal on key blocks (respects `prefers-reduced-motion`)
- Left slide-in mobile drawer
- Portuguese first; English texts prepared in catalog

## Notes

- Orders / inscriptions via WhatsApp (no payment backend).
- Catalog URL:  
  `https://res.cloudinary.com/ogtzpc3v/raw/upload/buzios/catalog.json`
- Store URL:  
  `https://res.cloudinary.com/ogtzpc3v/raw/upload/buzios/store.json`
- Media “delete” in admin only removes from the local library list (not Cloudinary).
- Keep Worker `public_id` paths in sync with load URLs (`store.json` / `catalog.json` — not bare `store` / `catalog`).
