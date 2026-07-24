ALTER TABLE "connect_credentials"
  ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb;
