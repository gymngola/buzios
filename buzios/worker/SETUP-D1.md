# Búzios — Cloudflare D1 setup

Operational data (clientes, inscrições, contactos, newsletter) moves to D1.  
Catalog (planos, textos, imagens) stays on Cloudinary.

## 1. Create the database (once)

From the `worker/` folder, logged into wrangler:

```bash
cd worker
npx wrangler d1 create buzios-db
```

Copy the `database_id` from the output and put it in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "buzios-db"
database_id = "e02a0a4d-a82e-437e-8466-6e985e417eaf"
migrations_dir = "migrations"
```

## 2. Apply schema

```bash
npx wrangler d1 migrations apply buzios-db --remote
```

Local optional (for tests):

```bash
npx wrangler d1 migrations apply buzios-db --local
```

## 3. Deploy Worker (binding goes live)

```bash
npx wrangler deploy
```

## 4. Import existing clients from Cloudinary store

After the Worker has the import route (next step in code):

```bash
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ADMIN_PASSWORD","action":"d1_import_from_store"}'
```

Expect something like: `{"ok":true,"clients":263,"submissions":2,...}`

## 5. Verify

```bash
npx wrangler d1 execute buzios-db --remote \
  --command "SELECT COUNT(*) AS n FROM clients;"
```

## Current state (2026-11-06)

- Import done (263 clients).
- Admin **reads** clients from D1.
- Admin **reads** inbox (submissions) from D1 (`d1_get_submissions` + overlay).
- Admin client + submission + newsletter **writes** dual-write Cloudinary + D1.
- Public `/submit` dual-writes to D1 (enrollment → submission + optional client).
- Admin still **reads** newsletter from Cloudinary — next short phase.

## Rollback

Cloudinary `store.json` is **not** deleted. Dual-write keeps it in sync on admin edits.  
If D1 looks wrong, fix and re-import (import upserts by `id`).

## Files

| Path | Role |
|------|------|
| `migrations/0001_init.sql` | Tables + indexes |
| `wrangler.toml` | D1 binding |
| `src/index.js` | Dual-write on `/submit` + client/submission/newsletter admin mutations; `d1_get_clients`, `d1_get_submissions` |
| `../js/admin.js` | Overlays clients + submissions from D1 after load and relevant mutations |
