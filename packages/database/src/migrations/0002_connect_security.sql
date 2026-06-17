-- Connect API tenant-bound credentials (closes CRITICAL #2 from the security audit).
-- Each row binds an opaque API key (sha256-hashed, never plaintext) to a single propertyId.
-- The legacy CONNECT_API_KEY env var stays valid as a cross-tenant 'platform' key.

CREATE TABLE IF NOT EXISTS "connect_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "property_id" uuid NOT NULL REFERENCES "properties"("id"),
  "label" varchar(200) NOT NULL,
  "key_hash" varchar(64) NOT NULL UNIQUE,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "connect_credentials_property_id_idx"
  ON "connect_credentials" ("property_id");
