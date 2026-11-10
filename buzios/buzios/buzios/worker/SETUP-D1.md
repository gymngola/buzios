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

- `0001_init.sql` — clients, submissions, newsletters, audit_log  
- `0002_trash.sql` — `deleted_at` on clients + submissions (30-day trash)

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

## Backup (critical — read this)

D1 **Time Travel** recovers the DB to any minute in the last **7 days (Free)** or **30 days (Workers Paid)**.  
That alone is **not** enough for long-term safety. Keep off-platform snapshots on Cloudinary.

### Automatic (cron — every ~6 days)

Configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 1,7,13,19,25 * *"]   # 03:00 UTC on days 1,7,13,19,25
```

On each run the Worker exports D1 → Cloudinary:

| Public ID | Role |
|-----------|------|
| `buzios/backups/d1-YYYY-MM-DD.json` | **Dated history** (survives beyond Time Travel) |
| `buzios/d1-backup.json` | Always-latest pointer |
| `buzios/store.json` | Emergency snapshot for rollback / old tooling |

The same cron also **purges trash older than 30 days** (clients + submissions with `deleted_at`).

After deploy, confirm the trigger is registered:

```bash
cd worker && npx wrangler deployments list
# or check Cloudflare dashboard → Workers → buzios-publish → Triggers
```

### Trash (soft delete)

| Action | Behaviour |
|--------|-----------|
| Arquivar client | `membership_status = arquivado` (not trash) |
| Apagar / Lixeira | Sets `deleted_at` — hidden from main lists; filter **Lixeira (30d)** |
| Restaurar | Clears `deleted_at` |
| Apagar já (in lixeira) | Permanent `DELETE` |
| Auto | Cron purges rows with `deleted_at` older than 30 days |

### On demand (manual)

```bash
curl -sS -X POST "https://buzios-publish.gymngola.workers.dev/admin/data" \
  -H "Content-Type: application/json" \
  -d '{"password":"…","action":"d1_backup"}'
```

Same three files as above. Prefer running this after bulk imports, mass deletes, or before risky admin work.

### Reminder

- **At least every 6 days** a Cloudinary snapshot must exist (cron does this after deploy).
- Prefer **Workers Paid** for 30-day Time Travel.
- Dated files under `buzios/backups/` are the durable archive; do not delete them casually.
- Admin **Clientes → Backup** still downloads a full JSON to the staff browser (local copy).

## Rollback

1. Set `WRITE_OPS_TO_STORE = true` in `src/index.js` and redeploy (dual-write again).
2. Or restore from latest `d1-backup.json` / `store.json` / `buzios/backups/d1-*.json` via `d1_import_from_store` after loading store.
3. Cloudinary files are **not** deleted on cutover.
4. Within the Time Travel window: restore D1 to a prior minute (dashboard or `wrangler d1 time-travel`).

## Files

| Path | Role |
|------|------|
| `migrations/0001_init.sql` | Tables + indexes |
| `migrations/0002_trash.sql` | `deleted_at` (30-day trash) |
| `wrangler.toml` | D1 binding + cron trigger |
| `src/index.js` | D1 writes; trash/restore/purge; cron backup + purge; `d1_backup` |
| `../js/admin.js` | Login via Worker; D1 overlays; Lixeira filters |
