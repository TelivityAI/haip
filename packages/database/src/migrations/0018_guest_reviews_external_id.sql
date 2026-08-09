-- Guest review external identity for ingest dedupe (TEL-8).
-- Applied idempotently via push-schema.ts; this file documents the incremental DDL.

ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS external_id varchar(255);
ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS external_url text;
ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS provider_place_id varchar(255);
ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS provider_location_id varchar(255);
ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS provider_channel_id varchar(255);
ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS guest_reviews_property_source_external_unique
  ON guest_reviews (property_id, source, external_id);
