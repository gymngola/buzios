-- Client portal: account auth, profile photo, documents, renewal requests
-- Apply: npx wrangler d1 migrations apply buzios-db --remote
--
-- NOTE: unique email index is NOT created here because existing data has
-- duplicate emails. Login uses lower(email) + LIMIT 1. Clean duplicates in
-- admin, then optionally:
--   CREATE UNIQUE INDEX idx_clients_email_unique
--     ON clients(email) WHERE email IS NOT NULL AND email != '';

-- Account / profile fields on existing clients table
ALTER TABLE clients ADD COLUMN password_hash TEXT;
ALTER TABLE clients ADD COLUMN photo_url TEXT;
ALTER TABLE clients ADD COLUMN documents_json TEXT;       -- JSON array of {id,type,name,url,uploaded_at}
ALTER TABLE clients ADD COLUMN account_status TEXT;       -- active | invited | locked | null
ALTER TABLE clients ADD COLUMN last_login_at TEXT;

-- Renewal / payment-proof / document requests queue
CREATE TABLE IF NOT EXISTS client_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- renew | payment_proof | document | profile_change
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | cancelled
  payload_json TEXT,               -- requested plan_id, cycle, message, etc.
  proof_url TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_requests_client ON client_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_requests_type ON client_requests(type);
CREATE INDEX IF NOT EXISTS idx_client_requests_created ON client_requests(created_at);
