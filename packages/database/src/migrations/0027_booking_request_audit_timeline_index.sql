CREATE INDEX IF NOT EXISTS audit_logs_property_entity_timeline_idx
  ON audit_logs (property_id, entity_type, entity_id, occurred_at, id);
