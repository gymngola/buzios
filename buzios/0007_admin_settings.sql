-- Global admin settings (auth epoch for remote force-logout)
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO admin_settings (key, value) VALUES ('auth_epoch', '1');
