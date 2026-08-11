-- Encrypted source-PMS credentials for automated migration connectors.
CREATE TABLE IF NOT EXISTS migration_source_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  source_pms varchar(50) NOT NULL,
  ciphertext text NOT NULL,
  encryption_key_id varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS migration_source_credentials_property_source_unique
  ON migration_source_credentials (property_id, source_pms);

CREATE INDEX IF NOT EXISTS migration_source_credentials_property_idx
  ON migration_source_credentials (property_id);
