-- HIA gap features: organizations, portfolio support, staff notifications
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  code varchar(20) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_notification_severity') THEN
  CREATE TYPE staff_notification_severity AS ENUM ('info','warning','critical');
END IF; END $$;

CREATE TABLE IF NOT EXISTS staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  user_id varchar(255),
  type varchar(50) NOT NULL,
  title varchar(255) NOT NULL,
  message text NOT NULL,
  severity staff_notification_severity NOT NULL DEFAULT 'info',
  source_event varchar(100),
  source_entity_type varchar(50),
  source_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_notifications_property_created_idx
  ON staff_notifications (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES staff_notifications(id),
  user_id varchar(255) NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_notification_reads_unique
  ON staff_notification_reads (notification_id, user_id);
