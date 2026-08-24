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
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_booking_request_installment_repair_unique
  ON audit_logs (entity_type, entity_id, ((new_value ->> 'repairKey')))
  WHERE entity_type = 'booking_request_installment'
    AND new_value ? 'repairKey';

-- booking_request_net_allocation_repair: releases allocations made stale by
-- completed refund/return movements from the pre-reconciliation release. Rows
-- are consumed deterministically by allocation creation order. The DO block is
-- one transaction scope: parent, allocation, and installment locks remain held
-- through both repairs, and audits are sourced only from DML RETURNING rows.
DO $booking_request_financial_repair_lock$
DECLARE
  repaired_count bigint;
BEGIN
  PERFORM parent.id
  FROM payments parent
  WHERE parent.booking_request_id IS NOT NULL
    AND parent.original_payment_id IS NULL
  ORDER BY parent.property_id, parent.booking_request_id, parent.id
  FOR UPDATE;

  PERFORM allocation.id
  FROM booking_request_payment_allocations allocation
  ORDER BY allocation.property_id, allocation.booking_request_id,
           allocation.payment_id, allocation.created_at, allocation.id
  FOR UPDATE;

  PERFORM installment.id
  FROM booking_request_installments installment
  ORDER BY installment.property_id, installment.booking_request_id, installment.id
  FOR UPDATE;

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
             AS new_amount
    FROM ranked
    WHERE ranked.old_amount >
      GREATEST(LEAST(ranked.old_amount, ranked.net_amount - ranked.used_before), 0)
  ), deleted AS (
    DELETE FROM booking_request_payment_allocations allocation
    USING changes
    WHERE allocation.id = changes.id
      AND allocation.amount = changes.old_amount
      AND changes.new_amount = 0
    RETURNING allocation.id, allocation.property_id, allocation.booking_request_id,
      allocation.payment_id, allocation.installment_id,
      changes.old_amount, changes.new_amount
  ), updated AS (
    UPDATE booking_request_payment_allocations allocation
    SET amount = changes.new_amount
    FROM changes
    WHERE allocation.id = changes.id
      AND allocation.amount = changes.old_amount
      AND changes.new_amount > 0
      AND changes.new_amount < changes.old_amount
    RETURNING allocation.id, allocation.property_id, allocation.booking_request_id,
      allocation.payment_id, allocation.installment_id,
      changes.old_amount, changes.new_amount
  ), mutations AS (
    SELECT * FROM deleted
    UNION ALL
    SELECT * FROM updated
  ), audit_evidence AS (
    INSERT INTO audit_logs (
      property_id, action, entity_type, entity_id, previous_value, new_value, description
    )
    SELECT mutation.property_id,
           CASE WHEN mutation.new_amount = 0 THEN 'delete' ELSE 'update' END,
           'booking_request_payment_allocation',
           mutation.id,
           jsonb_build_object('amount', mutation.old_amount::text),
           jsonb_build_object(
             'repairKey', 'task7-net-allocation-v1:' || mutation.id::text || ':'
               || mutation.old_amount::text || ':' || mutation.new_amount::text,
             'bookingRequestId', mutation.booking_request_id,
             'paymentId', mutation.payment_id,
             'installmentId', mutation.installment_id,
             'oldAmount', mutation.old_amount::text,
             'newAmount', mutation.new_amount::text
           ),
           'System repaired Booking Request payment allocation to net captured capacity'
    FROM mutations mutation
    ON CONFLICT DO NOTHING
    RETURNING entity_id
  )
  SELECT COUNT(*) INTO repaired_count FROM audit_evidence;

  WITH installment_totals AS (
    SELECT installment.id,
           installment.property_id,
           installment.booking_request_id,
           installment.allocated_amount AS old_allocated_amount,
           installment.status AS old_status,
           installment.resolved_amount,
           COALESCE(SUM(allocation.amount), 0) AS amount
    FROM booking_request_installments installment
    LEFT JOIN booking_request_payment_allocations allocation
      ON allocation.property_id = installment.property_id
     AND allocation.booking_request_id = installment.booking_request_id
     AND allocation.installment_id = installment.id
    GROUP BY installment.id, installment.property_id, installment.booking_request_id,
      installment.allocated_amount, installment.status, installment.resolved_amount
  ), changes AS (
    SELECT total.*,
           LEAST(total.amount, total.resolved_amount)::numeric(12,2) AS new_allocated_amount,
           CASE
             WHEN total.amount <= 0 THEN 'unpaid'
             WHEN total.amount >= total.resolved_amount THEN 'paid'
             ELSE 'partial'
           END::booking_request_installment_status AS new_status
    FROM installment_totals total
  ), updated AS (
    UPDATE booking_request_installments installment
    SET allocated_amount = changes.new_allocated_amount,
        status = changes.new_status,
        updated_at = now()
    FROM changes
    WHERE installment.id = changes.id
      AND installment.allocated_amount = changes.old_allocated_amount
      AND installment.status = changes.old_status
      AND (
        changes.old_allocated_amount IS DISTINCT FROM changes.new_allocated_amount
        OR changes.old_status IS DISTINCT FROM changes.new_status
      )
    RETURNING installment.id, installment.property_id, installment.booking_request_id,
      changes.old_allocated_amount, changes.old_status,
      changes.new_allocated_amount, changes.new_status
  ), audit_evidence AS (
    INSERT INTO audit_logs (
      property_id, action, entity_type, entity_id, previous_value, new_value, description
    )
    SELECT repaired.property_id,
           'update',
           'booking_request_installment',
           repaired.id,
           jsonb_build_object(
             'allocatedAmount', repaired.old_allocated_amount::text,
             'status', repaired.old_status
           ),
           jsonb_build_object(
             'repairKey', 'task7-installment-derived-v1:' || repaired.id::text || ':'
               || repaired.old_allocated_amount::text || ':' || repaired.old_status::text || ':'
               || repaired.new_allocated_amount::text || ':' || repaired.new_status::text,
             'bookingRequestId', repaired.booking_request_id,
             'oldAllocatedAmount', repaired.old_allocated_amount::text,
             'newAllocatedAmount', repaired.new_allocated_amount::text,
             'oldStatus', repaired.old_status,
             'newStatus', repaired.new_status
           ),
           'System repaired Booking Request installment derived payment state'
    FROM updated repaired
    ON CONFLICT DO NOTHING
    RETURNING entity_id
  )
  SELECT COUNT(*) INTO repaired_count FROM audit_evidence;
END
$booking_request_financial_repair_lock$;

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
