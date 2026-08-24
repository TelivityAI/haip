-- Exact provider recovery, financial lifecycle checks, and aggregate ownership.

ALTER TABLE booking_request_payment_resolutions
  ADD COLUMN IF NOT EXISTS provider_transaction_id varchar(255),
  ADD COLUMN IF NOT EXISTS provider_status varchar(40);

-- Recover canonical movement provenance written by the Task 7 release before
-- movement_id became mandatory. The UUID marker was deliberately persisted in
-- reason, and payment ownership/amount are rechecked here before linking it.
UPDATE booking_request_payment_resolutions r
SET movement_id = p.id,
    provider_transaction_id = CASE
      WHEN r.type = 'refund' THEN COALESCE(r.provider_transaction_id, p.gateway_transaction_id)
      ELSE r.provider_transaction_id
    END,
    provider_status = CASE
      WHEN r.type = 'refund' THEN COALESCE(r.provider_status, 'succeeded')
      ELSE r.provider_status
    END
FROM payments p
WHERE r.status = 'completed'
  AND r.type IN ('refund', 'external_return')
  AND r.movement_id IS NULL
  AND p.property_id = r.property_id
  AND p.booking_request_id = r.booking_request_id
  AND p.original_payment_id = r.payment_id
  AND r.reason LIKE '%' || p.id::text || '%';

UPDATE booking_request_payment_resolutions r
SET provider_transaction_id = COALESCE(r.provider_transaction_id, p.gateway_transaction_id),
    provider_status = COALESCE(r.provider_status, 'succeeded')
FROM payments p
WHERE r.type = 'refund'
  AND r.status = 'completed'
  AND r.movement_id = p.id;

UPDATE booking_request_payment_resolutions
SET resolved_at = COALESCE(resolved_at, updated_at, created_at)
WHERE status IN ('completed', 'failed');

DO $booking_request_resolution_provenance$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM booking_request_payment_resolutions
    WHERE status = 'completed'
      AND type IN ('refund', 'external_return')
      AND movement_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Completed Booking Request refund/return lacks canonical movement provenance';
  END IF;
END
$booking_request_resolution_provenance$;

CREATE UNIQUE INDEX IF NOT EXISTS br_payment_resolutions_property_provider_tx_unique
  ON booking_request_payment_resolutions (property_id, provider_transaction_id);

ALTER TABLE booking_request_payment_resolutions
  DROP CONSTRAINT IF EXISTS booking_request_payment_resolutions_retained_reason_check,
  DROP CONSTRAINT IF EXISTS booking_request_payment_resolutions_lifecycle_check;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_retained_reason_check') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_retained_reason_check
      CHECK (type <> 'retained' OR (reason IS NOT NULL AND NULLIF(BTRIM(reason), '') IS NOT NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_lifecycle_check') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_lifecycle_check
      CHECK (
        (status = 'pending' AND type = 'refund'
          AND idempotency_key IS NOT NULL AND operation_fingerprint IS NOT NULL
          AND resolved_at IS NULL AND movement_id IS NULL)
        OR
        (status = 'failed' AND type = 'refund'
          AND idempotency_key IS NOT NULL AND operation_fingerprint IS NOT NULL
          AND resolved_at IS NOT NULL AND movement_id IS NULL)
        OR
        (status = 'completed' AND resolved_at IS NOT NULL AND (
          (type IN ('refund', 'external_return') AND movement_id IS NOT NULL)
          OR
          (type = 'retained' AND movement_id IS NULL)
        ))
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_child_shape_check') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_booking_request_child_shape_check
      CHECK (booking_request_id IS NULL OR original_payment_id IS NULL OR (amount < 0 AND status = 'captured')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_installments_request_fkey') THEN
    ALTER TABLE booking_request_installments ADD CONSTRAINT booking_request_installments_request_fkey
      FOREIGN KEY (property_id, booking_request_id)
      REFERENCES booking_requests(property_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_booking_request_fkey
      FOREIGN KEY (property_id, booking_request_id)
      REFERENCES booking_requests(property_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_parent_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_booking_request_parent_fkey
      FOREIGN KEY (property_id, booking_request_id, original_payment_id)
      REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
  END IF;
END $$;

ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_retained_reason_check;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_lifecycle_check;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_child_shape_check;
ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_request_fkey;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_fkey;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_parent_fkey;
