DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migration_job_status') THEN
    CREATE TYPE migration_job_status AS ENUM ('pending','running','completed','failed','paused');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migration_row_status') THEN
    CREATE TYPE migration_row_status AS ENUM ('pending','succeeded','failed','skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS migration_legacy_id_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  project_id varchar(120) NOT NULL,
  entity varchar(80) NOT NULL,
  legacy_id varchar(120) NOT NULL,
  haip_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS migration_legacy_id_map_project_entity_legacy_unique
  ON migration_legacy_id_map (property_id, project_id, entity, legacy_id);

CREATE TABLE IF NOT EXISTS migration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  project_id varchar(120) NOT NULL,
  entity varchar(80) NOT NULL,
  status migration_job_status NOT NULL DEFAULT 'pending',
  dry_run boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  checkpoint_cursor integer NOT NULL DEFAULT 0,
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  succeeded_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS migration_row_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES migration_jobs(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  row_index integer NOT NULL,
  status migration_row_status NOT NULL DEFAULT 'pending',
  legacy_id varchar(120),
  haip_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS migration_row_results_job_row_unique
  ON migration_row_results (job_id, row_index);
