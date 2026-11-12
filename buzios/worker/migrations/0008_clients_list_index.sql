-- Optional composite index for client list filters / future server-side sorts.
-- List endpoint no longer ORDER BYs in SQL (admin sorts in browser), but this
-- helps membership/member_number lookups stay cheap as the table grows.

CREATE INDEX IF NOT EXISTS idx_clients_member_name
  ON clients (member_number, name);
