-- Client training / attendance sessions
CREATE TABLE IF NOT EXISTS trainings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  trained_at TEXT NOT NULL,
  trained_date TEXT NOT NULL,
  recorded_by TEXT,
  note TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_trainings_client ON trainings(client_id);
CREATE INDEX IF NOT EXISTS idx_trainings_date ON trainings(trained_date);
CREATE INDEX IF NOT EXISTS idx_trainings_client_date ON trainings(client_id, trained_date);
