-- Webhook delivery deduplication by logical event id (crash-safe re-enqueue).
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS logical_event_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_property_subscription_logical_event_unique
  ON webhook_deliveries (property_id, subscription_id, logical_event_id);
