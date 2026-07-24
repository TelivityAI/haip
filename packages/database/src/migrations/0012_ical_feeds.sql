-- B3: iCal calendar bridge (.ics import/export)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ical_feed_direction') THEN
    CREATE TYPE ical_feed_direction AS ENUM ('import', 'export');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ical_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  direction ical_feed_direction NOT NULL,
  name varchar(120) NOT NULL,
  source_url text,
  token_hash varchar(64),
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status varchar(20),
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ical_feeds_property_room_direction_idx
  ON ical_feeds (property_id, room_type_id, direction);

CREATE TABLE IF NOT EXISTS ical_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  feed_id uuid NOT NULL REFERENCES ical_feeds(id),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  external_uid varchar(255) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  summary varchar(255),
  source_checksum varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ical_blocks_property_room_dates_idx
  ON ical_blocks (property_id, room_type_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS ical_blocks_feed_dates_idx
  ON ical_blocks (feed_id, start_date, end_date);
