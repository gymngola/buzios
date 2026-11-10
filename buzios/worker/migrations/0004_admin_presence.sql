-- Admin panel presence (who has the panel open)
CREATE TABLE IF NOT EXISTS admin_presence (
  session_id TEXT PRIMARY KEY,
  last_seen TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_presence_seen ON admin_presence(last_seen);
