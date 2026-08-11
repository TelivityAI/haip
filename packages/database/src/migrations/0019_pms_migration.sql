-- PMS migration foundation (TEL-67/70): durable migration jobs, legacy id map,
-- and encrypted-at-app source-PMS credential storage.
-- Applied idempotently via push-schema.ts; this file documents the incremental DDL.

CREATE TYPE migration_job_status AS ENUM
  ('pending','running','completed','completed_with_errors','failed','cancelled');
CREATE TYPE migration_entity AS ENUM
  ('guests','room-types','rooms','rate-plans','reservations','folio-balances');

CREATE TABLE IF NOT EXISTS migration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  project_ref varchar(120) NOT NULL,
  entity migration_entity NOT NULL,
  status migration_job_status NOT NULL DEFAULT 'pending',
  rows jsonb NOT NULL,
  total_rows integer NOT NULL,
  processed_rows integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  dry_run varchar(5) NOT NULL DEFAULT 'false',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migration_jobs_property_status_idx
  ON migration_jobs (property_id, status);
CREATE INDEX IF NOT EXISTS migration_jobs_project_ref_idx
  ON migration_jobs (property_id, project_ref);

CREATE TABLE IF NOT EXISTS migration_legacy_id_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  project_ref varchar(120) NOT NULL,
  entity migration_entity NOT NULL,
  legacy_id varchar(255) NOT NULL,
  haip_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_legacy_id_map_unique
  ON migration_legacy_id_map (property_id, project_ref, entity, legacy_id);
CREATE INDEX IF NOT EXISTS migration_legacy_id_map_lookup_idx
  ON migration_legacy_id_map (property_id, project_ref, entity, haip_id);

CREATE TABLE IF NOT EXISTS migration_source_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  source_pms varchar(60) NOT NULL,
  ciphertext text NOT NULL,
  key_id varchar(40) NOT NULL,
  created_by varchar(255),
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_source_credentials_unique
  ON migration_source_credentials (property_id, source_pms);
