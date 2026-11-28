-- Speed up client-scoped audit lookups (get_client_history, filtered get_audit_log).
-- Previously full-table scans with OR + LIKE on detail dominated D1 row reads.
CREATE INDEX IF NOT EXISTS idx_audit_entity_id ON audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_id_desc ON audit_log(id DESC);
