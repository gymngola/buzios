-- 30-day trash: soft-delete columns (hard purge after 30 days via cron)
ALTER TABLE clients ADD COLUMN deleted_at TEXT;
ALTER TABLE submissions ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_deleted ON clients(deleted_at);
CREATE INDEX IF NOT EXISTS idx_submissions_deleted ON submissions(deleted_at);
