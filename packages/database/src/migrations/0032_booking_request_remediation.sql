-- Migration 0032: durable Booking Request sort and audit timeline keys.
-- Each table transition is one statement and holds an exclusive table lock, so
-- it is atomic whether the migration runner wraps the file or autocommits it.

CREATE OR REPLACE FUNCTION booking_requests_fill_submitted_total()
RETURNS trigger
LANGUAGE plpgsql
AS $booking_requests_fill_submitted_total$
BEGIN
  IF NEW.submitted_total IS NULL THEN
    IF jsonb_typeof(NEW.submitted_quote_snapshot -> 'grandTotal') IS DISTINCT FROM 'string'
      OR NEW.submitted_quote_snapshot->>'grandTotal' !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
    THEN
      RAISE EXCEPTION 'Cannot derive booking_requests.submitted_total from an invalid submitted quote total';
    END IF;
    IF (NEW.submitted_quote_snapshot->>'grandTotal')::numeric > 9999999999.99 THEN
      RAISE EXCEPTION 'Cannot derive booking_requests.submitted_total from an invalid submitted quote total';
    END IF;
    NEW.submitted_total :=
      (NEW.submitted_quote_snapshot->>'grandTotal')::numeric(12,2);
  END IF;
  RETURN NEW;
END
$booking_requests_fill_submitted_total$;

DO $booking_request_submitted_total_transition$
BEGIN
  EXECUTE 'LOCK TABLE booking_requests IN ACCESS EXCLUSIVE MODE';
  EXECUTE 'ALTER TABLE booking_requests
    ADD COLUMN IF NOT EXISTS submitted_total numeric(12,2)';
  EXECUTE 'DROP TRIGGER IF EXISTS booking_requests_submitted_total_compat
    ON booking_requests';
  EXECUTE 'CREATE TRIGGER booking_requests_submitted_total_compat
    BEFORE INSERT OR UPDATE ON booking_requests
    FOR EACH ROW EXECUTE FUNCTION booking_requests_fill_submitted_total()';

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

  UPDATE booking_requests
  SET submitted_total = (submitted_quote_snapshot->>'grandTotal')::numeric(12,2)
  WHERE submitted_total IS NULL;

  EXECUTE 'ALTER TABLE booking_requests
    ALTER COLUMN submitted_total SET NOT NULL';
  EXECUTE 'CREATE INDEX IF NOT EXISTS booking_requests_property_submitted_total_idx
    ON booking_requests (property_id, submitted_total, id)';
END
$booking_request_submitted_total_transition$;

CREATE SEQUENCE IF NOT EXISTS audit_logs_timeline_sequence_seq AS bigint;

DO $audit_logs_timeline_sequence_transition$
DECLARE
  sequence_last_value bigint;
  sequence_is_called boolean;
  timeline_max bigint;
BEGIN
  EXECUTE 'LOCK TABLE audit_logs IN ACCESS EXCLUSIVE MODE';
  EXECUTE 'ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS timeline_sequence bigint';

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

  SELECT last_value, is_called
  INTO sequence_last_value, sequence_is_called
  FROM audit_logs_timeline_sequence_seq;
  SELECT max(timeline_sequence) INTO timeline_max FROM audit_logs;
  PERFORM setval(
    'audit_logs_timeline_sequence_seq'::regclass,
    GREATEST(sequence_last_value, COALESCE(timeline_max, 1)),
    sequence_is_called OR timeline_max IS NOT NULL
  );

  EXECUTE 'ALTER TABLE audit_logs
    ALTER COLUMN timeline_sequence
      SET DEFAULT nextval(''audit_logs_timeline_sequence_seq''::regclass),
    ALTER COLUMN timeline_sequence SET NOT NULL';
  EXECUTE 'ALTER SEQUENCE audit_logs_timeline_sequence_seq
    OWNED BY audit_logs.timeline_sequence';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_timeline_sequence_unique
    ON audit_logs (timeline_sequence)';
  EXECUTE 'DROP INDEX IF EXISTS audit_logs_booking_request_timeline_idx';
  EXECUTE 'CREATE INDEX audit_logs_booking_request_timeline_idx
    ON audit_logs (property_id, booking_request_id, timeline_sequence DESC)';
END
$audit_logs_timeline_sequence_transition$;
