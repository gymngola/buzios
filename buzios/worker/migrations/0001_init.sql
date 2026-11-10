-- Búzios operational data (clients + inbox)
-- Catalog (plans/texts/images) stays on Cloudinary.

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  member_number INTEGER,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  area TEXT,
  age REAL,
  schedule TEXT,
  has_card TEXT,
  plan_id TEXT,
  plan_name TEXT,
  price REAL,
  billing_cycle TEXT,
  plan_start TEXT,
  plan_end TEXT,
  membership_status TEXT,
  billing_status TEXT,
  last_payment_at TEXT,
  payments_json TEXT,          -- JSON array
  notes TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  from_import INTEGER DEFAULT 0,
  from_submission TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(membership_status);
CREATE INDEX IF NOT EXISTS idx_clients_plan_end ON clients(plan_end);
CREATE INDEX IF NOT EXISTS idx_clients_member_number ON clients(member_number);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  type TEXT,                   -- enrollment | contact
  status TEXT,
  area TEXT,
  plan_id TEXT,
  plan_name TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  message TEXT,
  subject TEXT,
  prefer_contact TEXT,
  payload_json TEXT,           -- full original object for extras/attachments
  from_client_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);

CREATE TABLE IF NOT EXISTS newsletters (
  id TEXT PRIMARY KEY,
  phone TEXT,
  name TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_newsletters_phone ON newsletters(phone);

-- Simple write log for recovery / debugging
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);
