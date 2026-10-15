-- One webhook key id can verify events for only one enabled property.
CREATE UNIQUE INDEX IF NOT EXISTS property_integrations_worldline_webhook_key_idx
  ON property_integrations ((config->>'webhookKeyId'))
  WHERE catalog_slug = 'worldline'
    AND enabled = true
    AND coalesce(config->>'webhookKeyId', '') <> '';
