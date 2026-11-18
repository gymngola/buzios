-- Per-client structured training sheet (prescription + evaluations)
-- Separate table so the normal Clientes profile modal stays untouched.
CREATE TABLE IF NOT EXISTS training_sheets (
  client_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_sheets_updated ON training_sheets(updated_at);
