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
CREATE UNIQUE INDEX IF NOT EXISTS payments_property_request_parent_id_unique
  ON payments (property_id, booking_request_id, original_payment_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_booking_request_allocation_repair_unique
  ON audit_logs (entity_type, entity_id, ((new_value ->> 'repairKey')))
  WHERE entity_type = 'booking_request_payment_allocation'
    AND new_value ? 'repairKey';

-- booking_request_net_allocation_repair: releases allocations made stale by
-- completed refund/return movements from the pre-reconciliation release. Rows
-- are consumed deterministically by allocation creation order. Audit evidence
-- and allocation changes share one statement, so neither can commit alone.
WITH net_capacity AS (
  SELECT parent.property_id,
         parent.booking_request_id,
         parent.id AS payment_id,
         GREATEST(parent.amount + COALESCE(SUM(child.amount)
           FILTER (WHERE child.status = 'captured'), 0), 0) AS net_amount
  FROM payments parent
  LEFT JOIN payments child
    ON child.property_id = parent.property_id
   AND child.booking_request_id = parent.booking_request_id
   AND child.original_payment_id = parent.id
  WHERE parent.booking_request_id IS NOT NULL
    AND parent.original_payment_id IS NULL
  GROUP BY parent.property_id, parent.booking_request_id, parent.id, parent.amount
), ranked AS (
  SELECT allocation.id,
         allocation.property_id,
         allocation.booking_request_id,
         allocation.payment_id,
         allocation.installment_id,
         allocation.amount AS old_amount,
         capacity.net_amount,
         COALESCE(SUM(allocation.amount) OVER (
           PARTITION BY allocation.property_id, allocation.booking_request_id, allocation.payment_id
           ORDER BY allocation.created_at, allocation.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS used_before
  FROM booking_request_payment_allocations allocation
  JOIN net_capacity capacity
    ON capacity.property_id = allocation.property_id
   AND capacity.booking_request_id = allocation.booking_request_id
   AND capacity.payment_id = allocation.payment_id
), changes AS (
  SELECT ranked.*,
         GREATEST(LEAST(ranked.old_amount, ranked.net_amount - ranked.used_before), 0)
           AS new_amount,
         'task7-net-allocation-v1:' || ranked.id::text || ':'
           || ranked.old_amount::text || ':'
           || GREATEST(LEAST(ranked.old_amount, ranked.net_amount - ranked.used_before), 0)::text
           AS repair_key
  FROM ranked
  WHERE ranked.old_amount IS DISTINCT FROM
    GREATEST(LEAST(ranked.old_amount, ranked.net_amount - ranked.used_before), 0)
), audit_evidence AS (
  INSERT INTO audit_logs (
    property_id,
    action,
    entity_type,
    entity_id,
    previous_value,
    new_value,
    description
  )
  SELECT changes.property_id,
         CASE WHEN changes.new_amount = 0 THEN 'delete' ELSE 'update' END,
         'booking_request_payment_allocation',
         changes.id,
         jsonb_build_object('amount', changes.old_amount::text),
         jsonb_build_object(
           'repairKey', changes.repair_key,
           'bookingRequestId', changes.booking_request_id,
           'paymentId', changes.payment_id,
           'installmentId', changes.installment_id,
           'oldAmount', changes.old_amount::text,
           'newAmount', changes.new_amount::text
         ),
         'System repaired Booking Request payment allocation to net captured capacity'
  FROM changes
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit_logs existing
    WHERE existing.entity_type = 'booking_request_payment_allocation'
      AND existing.entity_id = changes.id
      AND existing.new_value ->> 'repairKey' = changes.repair_key
  )
  ON CONFLICT DO NOTHING
  RETURNING entity_id
), deleted AS (
  DELETE FROM booking_request_payment_allocations allocation
  USING changes
  WHERE allocation.id = changes.id
    AND changes.new_amount = 0
  RETURNING allocation.id
), updated AS (
  UPDATE booking_request_payment_allocations allocation
  SET amount = changes.new_amount
  FROM changes
  WHERE allocation.id = changes.id
    AND changes.new_amount > 0
    AND allocation.amount IS DISTINCT FROM changes.new_amount
  RETURNING allocation.id
)
SELECT COUNT(*) FROM audit_evidence;

WITH installment_totals AS (
  SELECT installment.id,
         installment.resolved_amount,
         COALESCE(SUM(allocation.amount), 0) AS amount
  FROM booking_request_installments installment
  LEFT JOIN booking_request_payment_allocations allocation
    ON allocation.property_id = installment.property_id
   AND allocation.booking_request_id = installment.booking_request_id
   AND allocation.installment_id = installment.id
  GROUP BY installment.id, installment.resolved_amount
), derived AS (
  SELECT total.id,
         LEAST(total.amount, total.resolved_amount) AS allocated_amount,
         CASE
           WHEN total.amount <= 0 THEN 'unpaid'
           WHEN total.amount >= total.resolved_amount THEN 'paid'
           ELSE 'partial'
         END::booking_request_installment_status AS status
  FROM installment_totals total
)
UPDATE booking_request_installments installment
SET allocated_amount = derived.allocated_amount,
    status = derived.status,
    updated_at = now()
FROM derived
WHERE installment.id = derived.id
  AND (
    installment.allocated_amount IS DISTINCT FROM derived.allocated_amount
    OR installment.status IS DISTINCT FROM derived.status
  );

ALTER TABLE booking_request_payment_resolutions
  DROP CONSTRAINT IF EXISTS booking_request_payment_resolutions_retained_reason_check,
  DROP CONSTRAINT IF EXISTS booking_request_payment_resolutions_lifecycle_check;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_consequences_request_fkey') THEN
    ALTER TABLE booking_request_consequences ADD CONSTRAINT booking_request_consequences_request_fkey
      FOREIGN KEY (property_id, booking_request_id)
      REFERENCES booking_requests(property_id, id) NOT VALID;
  END IF;
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_parent_movement_fkey') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_parent_movement_fkey
      FOREIGN KEY (property_id, booking_request_id, payment_id, movement_id)
      REFERENCES payments(property_id, booking_request_id, original_payment_id, id) NOT VALID;
  END IF;
END $$;

ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_retained_reason_check;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_lifecycle_check;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_child_shape_check;
ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_request_fkey;
ALTER TABLE booking_request_consequences VALIDATE CONSTRAINT booking_request_consequences_request_fkey;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_fkey;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_parent_fkey;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_parent_movement_fkey;
