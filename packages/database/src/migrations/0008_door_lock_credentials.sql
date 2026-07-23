-- Door-lock credentials: persisted PIN / access codes per reservation.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'door_lock_credential_status') THEN
  CREATE TYPE door_lock_credential_status AS ENUM ('active','revoked');
END IF; END $$;

CREATE TABLE IF NOT EXISTS door_lock_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  room_id uuid REFERENCES rooms(id),
  provider varchar(50) NOT NULL,
  credential_id varchar(100) NOT NULL,
  access_code varchar(20),
  status door_lock_credential_status NOT NULL DEFAULT 'active',
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS door_lock_credentials_property_reservation_unique
  ON door_lock_credentials (property_id, reservation_id);

CREATE INDEX IF NOT EXISTS door_lock_credentials_property_status_idx
  ON door_lock_credentials (property_id, status);
