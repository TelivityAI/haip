ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS booking_request_id uuid;

UPDATE audit_logs
SET booking_request_id = CASE
  WHEN entity_type = 'booking_request' THEN entity_id
  ELSE COALESCE(
    CASE WHEN new_value->>'bookingRequestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (new_value->>'bookingRequestId')::uuid END,
    CASE WHEN new_value->>'requestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (new_value->>'requestId')::uuid END,
    CASE WHEN previous_value->>'bookingRequestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (previous_value->>'bookingRequestId')::uuid END,
    CASE WHEN previous_value->>'requestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (previous_value->>'requestId')::uuid END
  )
END
WHERE booking_request_id IS NULL
  AND (entity_type = 'booking_request' OR new_value IS NOT NULL OR previous_value IS NOT NULL);

CREATE INDEX IF NOT EXISTS audit_logs_booking_request_timeline_idx
  ON audit_logs (property_id, booking_request_id, occurred_at DESC, id DESC);
