-- Migration 0029: direct booking-request audit relationships.
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

-- Preserve tombstones whose delete payload predates bookingRequestId. A sibling
-- audit row is authoritative only when this property/entity pair has exactly
-- one known request relationship; conflicting histories deliberately remain
-- unresolved rather than being assigned arbitrarily.
WITH unique_request_relationships AS (
  SELECT
    property_id,
    entity_type,
    entity_id,
    min(booking_request_id::text)::uuid AS booking_request_id
  FROM audit_logs
  WHERE property_id IS NOT NULL
    AND entity_id IS NOT NULL
    AND booking_request_id IS NOT NULL
  GROUP BY property_id, entity_type, entity_id
  HAVING count(DISTINCT booking_request_id) = 1
)
UPDATE audit_logs AS target
SET booking_request_id = relationship.booking_request_id
FROM unique_request_relationships AS relationship
WHERE target.booking_request_id IS NULL
  AND target.property_id = relationship.property_id
  AND target.entity_type = relationship.entity_type
  AND target.entity_id = relationship.entity_id;

CREATE INDEX IF NOT EXISTS audit_logs_booking_request_timeline_idx
  ON audit_logs (property_id, booking_request_id, occurred_at DESC, id DESC);
