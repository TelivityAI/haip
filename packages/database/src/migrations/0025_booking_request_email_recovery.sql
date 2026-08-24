ALTER TABLE booking_request_email_deliveries
  ADD COLUMN IF NOT EXISTS logical_key varchar(200),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

UPDATE booking_request_email_deliveries
SET logical_key = 'task8-legacy:' || id::text
WHERE logical_key IS NULL;

ALTER TABLE booking_request_email_deliveries
  ALTER COLUMN logical_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_request_email_deliveries_logical_key_unique
  ON booking_request_email_deliveries (property_id, booking_request_id, logical_key);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_request_email_deliveries_request_fkey'
  ) THEN
    ALTER TABLE booking_request_email_deliveries
      ADD CONSTRAINT booking_request_email_deliveries_request_fkey
      FOREIGN KEY (property_id, booking_request_id)
      REFERENCES booking_requests(property_id, id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE booking_request_email_deliveries
  VALIDATE CONSTRAINT booking_request_email_deliveries_request_fkey;
