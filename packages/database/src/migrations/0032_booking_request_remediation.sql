-- Migration 0032: durable Booking Request sort and audit timeline keys.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS submitted_total numeric(12,2);

DO $booking_request_submitted_total_precondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM booking_requests
    WHERE submitted_total IS NULL
      AND (
        jsonb_typeof(submitted_quote_snapshot -> 'grandTotal') IS DISTINCT FROM 'string'
        OR submitted_quote_snapshot->>'grandTotal' !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
        OR CASE
          WHEN submitted_quote_snapshot->>'grandTotal' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
            THEN (submitted_quote_snapshot->>'grandTotal')::numeric > 9999999999.99
          ELSE false
        END
      )
  ) THEN
    RAISE EXCEPTION 'Cannot backfill booking_requests.submitted_total from an invalid submitted quote total';
  END IF;
END
$booking_request_submitted_total_precondition$;

UPDATE booking_requests
SET submitted_total = (submitted_quote_snapshot->>'grandTotal')::numeric(12,2)
WHERE submitted_total IS NULL;

ALTER TABLE booking_requests
  ALTER COLUMN submitted_total SET NOT NULL;

CREATE INDEX IF NOT EXISTS booking_requests_property_submitted_total_idx
  ON booking_requests (property_id, submitted_total, id);

CREATE SEQUENCE IF NOT EXISTS audit_logs_timeline_sequence_seq AS bigint;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS timeline_sequence bigint;

WITH current_max AS (
  SELECT COALESCE(max(timeline_sequence), 0) AS value
  FROM audit_logs
), ordered AS (
  SELECT id,
    current_max.value + row_number() OVER (ORDER BY occurred_at, id) AS timeline_sequence
  FROM audit_logs
  CROSS JOIN current_max
  WHERE audit_logs.timeline_sequence IS NULL
)
UPDATE audit_logs AS target
SET timeline_sequence = ordered.timeline_sequence
FROM ordered
WHERE target.id = ordered.id;

SELECT setval(
  'audit_logs_timeline_sequence_seq'::regclass,
  COALESCE((SELECT max(timeline_sequence) FROM audit_logs), 1),
  EXISTS (SELECT 1 FROM audit_logs)
);

ALTER TABLE audit_logs
  ALTER COLUMN timeline_sequence SET DEFAULT nextval('audit_logs_timeline_sequence_seq'::regclass),
  ALTER COLUMN timeline_sequence SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_timeline_sequence_unique
  ON audit_logs (timeline_sequence);

DROP INDEX IF EXISTS audit_logs_booking_request_timeline_idx;
CREATE INDEX audit_logs_booking_request_timeline_idx
  ON audit_logs (property_id, booking_request_id, timeline_sequence DESC);
