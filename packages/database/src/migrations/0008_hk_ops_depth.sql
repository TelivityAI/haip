-- Housekeeping ops depth: lost-and-found items and service requests

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lost_and_found_status') THEN
  CREATE TYPE lost_and_found_status AS ENUM ('held','returned','disposed');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_status') THEN
  CREATE TYPE service_request_status AS ENUM ('open','in_progress','done','cancelled');
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_type') THEN
  CREATE TYPE service_request_type AS ENUM ('maintenance','turndown','deep_clean','checkout','stayover','inspection','service_request');
END IF; END $$;

CREATE TABLE IF NOT EXISTS lost_and_found_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  room_id uuid REFERENCES rooms(id),
  reservation_id uuid REFERENCES reservations(id),
  guest_id uuid REFERENCES guests(id),
  description text NOT NULL,
  tag_code varchar(50) NOT NULL,
  status lost_and_found_status NOT NULL DEFAULT 'held',
  found_at timestamptz NOT NULL DEFAULT now(),
  dispose_after timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lost_and_found_items_property_status_idx
  ON lost_and_found_items (property_id, status);

CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  room_id uuid REFERENCES rooms(id),
  reservation_id uuid REFERENCES reservations(id),
  type service_request_type NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status service_request_status NOT NULL DEFAULT 'open',
  title varchar(255) NOT NULL,
  description text,
  linked_task_id uuid REFERENCES housekeeping_tasks(id),
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_requests_property_status_idx
  ON service_requests (property_id, status);
