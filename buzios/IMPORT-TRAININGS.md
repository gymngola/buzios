# Import historical trainings from Excel

Source: `1 FACTURAÇÃO GIMY 2025.xlsx` → `import-trainings-from-excel.json`

## What was extracted

- Monthly sheets Jul 2024 – Dec 2025 (debtor / Tondo sheets skipped)
- Fields: member number (`Nº`), name, year, month, count
- Roman numerals → arabic; `S/P` → 0 (no sessions created)

Rough volume: ~1 180 month-records, ~9 200 sessions to insert for counts &gt; 0.

## Deploy worker first

The Worker action `import_trainings_bulk` must be live:

```bash
# from worker folder
npx wrangler deploy
```

## Run import (once)

POST to the Worker (password = admin password). Chunk the JSON if the request is large.

Example with curl (split records into batches of ~80 if needed):

```bash
# Example: first 80 records
node -e "
const fs=require('fs');
const all=JSON.parse(fs.readFileSync('import-trainings-from-excel.json','utf8')).records;
const chunk=all.slice(0,80);
fs.writeFileSync('/tmp/train-chunk.json', JSON.stringify({
  password: process.env.ADMIN_PASSWORD,
  action: 'import_trainings_bulk',
  adminName: 'Import Excel',
  data: { records: chunk }
}));
"

curl -sS -X POST https://buzios-publish.gymngola.workers.dev/admin/data \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/train-chunk.json
```

Repeat for the next slices (`slice(80,160)`, …).

Response shape:

```json
{ "ok": true, "inserted": 120, "skipped": 5, "unmatched": 2, "unmatchedSamples": [...] }
```

- **inserted** — training rows written  
- **skipped** — S/P (0), invalid rows, or month already imported for that client  
- **unmatched** — member number not found in D1 clients  

Import is **idempotent per client+month** (looks for note `Importado Excel — YYYY-MM`).

## Matching

Clients must have **Nº sócio** (`memberNumber`) set to the Excel `Nº`.

## After import

Open **Treinos** → pick a past month via the date picker → **Relatório do mês** / **CSV mês**.
