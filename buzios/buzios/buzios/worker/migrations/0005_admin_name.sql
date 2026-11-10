-- Named admin presence (who is online)
-- admin_name is best-effort; older sessions may be null

ALTER TABLE admin_presence ADD COLUMN admin_name TEXT;
