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

## Current state (2026-11-06 — cutover done)

- Import done (263 clients). Counts matched Cloudinary before cutover.
- Admin **reads** clients, inbox (submissions), and newsletter from D1.
- **Writes** go to **D1 only** (`WRITE_OPS_TO_STORE = false` in `src/index.js`).
- Public `/submit` writes to D1 only (enrollment → submission + optional client).
- Catalog stays on Cloudinary.
- Password: only in Worker secret `ADMIN_PASSWORD`. Admin login calls `action: "auth"`; no password in source.

## Backup

On demand (also refreshes `store.json` as emergency snapshot):

```bash
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"…","action":"d1_backup"}'
```

Writes `buzios/d1-backup.json` + updates `buzios/store.json`.  
Optional later: cron Worker calling the same action.

## Rollback

1. Set `WRITE_OPS_TO_STORE = true` in `src/index.js` and redeploy (dual-write again).
2. Or restore from latest `d1-backup.json` / `store.json` via `d1_import_from_store` after loading store.
3. Cloudinary files are **not** deleted on cutover.

## Files

| Path | Role |
|------|------|
| `migrations/0001_init.sql` | Tables + indexes |
| `wrangler.toml` | D1 binding |
| `src/index.js` | D1 primary writes; `WRITE_OPS_TO_STORE` flag; `auth`, `d1_backup`, `d1_get_*` |
| `../js/admin.js` | Login via Worker; overlays clients + submissions + newsletters from D1 |
