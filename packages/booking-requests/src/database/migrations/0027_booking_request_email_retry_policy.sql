-- Migration 0027: booking-request email retry policy.
ALTER TYPE booking_request_email_delivery_status
  ADD VALUE IF NOT EXISTS 'processing';

ALTER TABLE booking_request_email_deliveries
  ADD COLUMN IF NOT EXISTS automatic_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id varchar(500);

UPDATE booking_request_email_deliveries
SET status = 'processing',
    next_attempt_at = COALESCE(next_attempt_at, claimed_at)
WHERE status = 'pending'
  AND claimed_at IS NOT NULL;

UPDATE booking_request_email_deliveries
SET next_attempt_at = COALESCE(next_attempt_at, last_attempt_at, created_at, now())
WHERE status = 'pending'
  AND claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS booking_request_email_deliveries_recovery_idx
  ON booking_request_email_deliveries (status, next_attempt_at, claimed_at)
  WHERE status IN ('pending', 'processing');
