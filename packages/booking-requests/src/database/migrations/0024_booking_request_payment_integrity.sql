-- Migration 0024: Booking Request payment recovery and aggregate integrity.
-- Pending gateway operations are durable claims: provider I/O is always outside
-- the transaction and replay uses the same property-scoped idempotency key.

ALTER TABLE booking_request_payment_resolutions
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(255),
  ADD COLUMN IF NOT EXISTS operation_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS movement_id uuid,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE booking_request_payment_resolutions
  ALTER COLUMN resolved_at DROP NOT NULL,
  ALTER COLUMN resolved_at DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS booking_request_payment_resolutions_property_idempotency_unique
  ON booking_request_payment_resolutions (property_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_property_id_unique
  ON booking_requests (property_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_request_installments_property_request_id_unique
  ON booking_request_installments (property_id, booking_request_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_property_request_id_unique
  ON payments (property_id, booking_request_id, id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_installments_amount_kind_check') THEN
    ALTER TABLE booking_request_installments ADD CONSTRAINT booking_request_installments_amount_kind_check
      CHECK (((fixed_amount IS NOT NULL AND fixed_amount > 0 AND percentage IS NULL)
        OR (fixed_amount IS NULL AND percentage > 0 AND percentage <= 100))
        AND resolved_amount IS NOT NULL AND resolved_amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_installments_milestone_date_check') THEN
    ALTER TABLE booking_request_installments ADD CONSTRAINT booking_request_installments_milestone_date_check
      CHECK ((due_milestone = 'date' AND due_date IS NOT NULL)
        OR (due_milestone <> 'date' AND due_date IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_installments_allocated_nonnegative_check') THEN
    ALTER TABLE booking_request_installments ADD CONSTRAINT booking_request_installments_allocated_nonnegative_check
      CHECK (allocated_amount >= 0 AND allocated_amount <= resolved_amount) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_positive_check') THEN
    ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_positive_check
      CHECK (amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_positive_check') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_positive_check
      CHECK (amount > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_status_check') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_status_check
      CHECK (status IN ('pending', 'completed', 'failed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_retained_reason_check') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_retained_reason_check
      CHECK (type <> 'retained' OR NULLIF(BTRIM(reason), '') IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_parent_positive_check') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_booking_request_parent_positive_check
      CHECK (booking_request_id IS NULL OR original_payment_id IS NOT NULL OR amount > 0) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_request_fkey') THEN
    ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_request_fkey
      FOREIGN KEY (property_id, booking_request_id)
      REFERENCES booking_requests(property_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_payment_fkey') THEN
    ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_payment_fkey
      FOREIGN KEY (property_id, booking_request_id, payment_id)
      REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_installment_fkey') THEN
    ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_installment_fkey
      FOREIGN KEY (property_id, booking_request_id, installment_id)
      REFERENCES booking_request_installments(property_id, booking_request_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_request_fkey') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_request_fkey
      FOREIGN KEY (property_id, booking_request_id)
      REFERENCES booking_requests(property_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_payment_fkey') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_payment_fkey
      FOREIGN KEY (property_id, booking_request_id, payment_id)
      REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_movement_fkey') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_movement_fkey
      FOREIGN KEY (property_id, booking_request_id, movement_id)
      REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_movement_id_fkey') THEN
    ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_movement_id_fkey
      FOREIGN KEY (movement_id) REFERENCES payments(id) NOT VALID;
  END IF;
END $$;

ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_amount_kind_check;
ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_milestone_date_check;
ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_allocated_nonnegative_check;
ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_positive_check;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_positive_check;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_status_check;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_retained_reason_check;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_parent_positive_check;
ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_request_fkey;
ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_payment_fkey;
ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_installment_fkey;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_request_fkey;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_payment_fkey;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_movement_fkey;
ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_movement_id_fkey;
