# Búzios Health Club — Website

Luxury mobile-first brochure + admin site for **Búzios Health Club / Escola de Natação Búzios** (Luanda).

## Stack

- Pure HTML / CSS / JS (no build step)
- Cloudflare Pages (static)
- Cloudflare Worker (publish API — holds Cloudinary secrets)
- Cloudinary (unsigned media uploads + signed catalog.json)
- localStorage (admin drafts / same-browser preview)

## Pages

| File | Description |
|------|-------------|
| `index.html` | Home — hero, about, services, plans teaser |
| `ginasio.html` | Gym equipment & plans |
| `natacao.html` | Swimming school |
| `planos.html` | All plans & prices |
| `contacto.html` | Contact + WhatsApp form |
| `admin.html` | Staff panel (password-gated) |

## Setup checklist

1. **Cloudinary**
   - Cloud name: `ogtzpc3v` (already set)
   - Create an **unsigned** upload preset named `buzios_unsigned` (folder optional: `buzios`)
   - API key / secret only go into the Worker (never in the browser)

2. **Worker**
   ```bash
   cd worker
   npx wrangler deploy
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put CLOUDINARY_CLOUD_NAME
   npx wrangler secret put CLOUDINARY_API_KEY
   npx wrangler secret put CLOUDINARY_API_SECRET
   ```
   `PUBLISH_URL` in `js/admin.js` is set to:  
   `https://buzios-publish.gymngola.workers.dev/publish`

3. **Admin password**  
   Default in `js/admin.js`: `buzios2026` — **change after handoff**.

4. **Deploy static site**  
   Point Cloudflare Pages (or any static host) at the project root (folder containing `index.html`).

5. **Smoke test**
   - Open `/admin.html` → login
   - Edit a plan price → Guardar rascunho → open site in same browser
   - Carregar an image → assign to Hero → Publicar na loja
   - Hard-refresh public site (catalog loads from Cloudinary)

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
- Catalog URL pattern:  
  `https://res.cloudinary.com/ogtzpc3v/raw/upload/buzios/catalog.json`
- Media “delete” in admin only removes from local library list.
