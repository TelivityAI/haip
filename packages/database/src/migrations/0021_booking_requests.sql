-- Booking Requests — separate request-first aggregate and neutral configuration.
-- This is a forward-only migration. It preserves existing instant booking and
-- payment behavior while adding optional request provenance.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_status') THEN
    CREATE TYPE booking_request_status AS ENUM ('pending', 'accepted', 'denied');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_price_source') THEN
    CREATE TYPE booking_request_price_source AS ENUM ('submitted', 'current', 'custom');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_installment_milestone') THEN
    CREATE TYPE booking_request_installment_milestone AS ENUM ('date', 'arrival', 'checkout', 'manual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_installment_status') THEN
    CREATE TYPE booking_request_installment_status AS ENUM ('unpaid', 'partial', 'paid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_payment_resolution_type') THEN
    CREATE TYPE booking_request_payment_resolution_type AS ENUM ('refund', 'external_return', 'retained');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_email_delivery_kind') THEN
    CREATE TYPE booking_request_email_delivery_kind AS ENUM ('receipt', 'accepted', 'denied', 'payment', 'refund', 'failure');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_email_delivery_status') THEN
    CREATE TYPE booking_request_email_delivery_status AS ENUM ('pending', 'sent', 'failed');
  END IF;
END $$;

ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS booking_mode varchar(10);
ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS payment_method_collection varchar(10);
ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS form_questions jsonb;

ALTER TABLE booking_engine_config ALTER COLUMN booking_mode SET DEFAULT 'instant';
ALTER TABLE booking_engine_config ALTER COLUMN payment_method_collection SET DEFAULT 'disabled';
ALTER TABLE booking_engine_config ALTER COLUMN form_questions SET DEFAULT '[]'::jsonb;

UPDATE booking_engine_config
SET
  booking_mode = COALESCE(booking_mode, 'instant'),
  payment_method_collection = COALESCE(payment_method_collection, 'disabled'),
  form_questions = COALESCE(form_questions, '[]'::jsonb);

ALTER TABLE booking_engine_config ALTER COLUMN booking_mode SET NOT NULL;
ALTER TABLE booking_engine_config ALTER COLUMN payment_method_collection SET NOT NULL;
ALTER TABLE booking_engine_config ALTER COLUMN form_questions SET NOT NULL;

CREATE TABLE IF NOT EXISTS booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  submission_idempotency_key varchar(200) NOT NULL,
  submission_fingerprint varchar(64) NOT NULL,
  status booking_request_status NOT NULL DEFAULT 'pending',
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  guest_first_name varchar(100) NOT NULL,
  guest_last_name varchar(100) NOT NULL,
  guest_email varchar(255) NOT NULL,
  guest_phone varchar(50),
  special_requests text,
  service_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  form_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  application_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_quote_snapshot jsonb NOT NULL,
  current_quote_snapshot jsonb,
  currency_code varchar(3) NOT NULL,
  setup_intent_id varchar(255),
  stripe_customer_id varchar(255),
  stripe_payment_method_id varchar(255),
  card_last_four varchar(4),
  card_brand varchar(20),
  consent_text text,
  consent_version varchar(40),
  consented_at timestamptz,
  accepted_price_source booking_request_price_source,
  accepted_total numeric(12,2),
  custom_price_reason text,
  accepted_reservation_id uuid REFERENCES reservations(id),
  accepted_folio_id uuid REFERENCES folios(id),
  decided_by uuid,
  decided_at timestamptz,
  denial_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reconcile a local/intermediate copy of the unreleased table before creating
-- replay indexes. Stable legacy placeholders preserve every row without
-- inventing recoverable client payloads.
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS submission_idempotency_key varchar(200);
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS submission_fingerprint varchar(64);
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS setup_intent_id varchar(255);
UPDATE booking_requests
SET
  submission_idempotency_key = COALESCE(
    submission_idempotency_key,
    'legacy-' || id::text
  ),
  submission_fingerprint = COALESCE(
    submission_fingerprint,
    md5(id::text) || md5('booking-request:' || id::text)
  );
ALTER TABLE booking_requests ALTER COLUMN submission_idempotency_key SET NOT NULL;
ALTER TABLE booking_requests ALTER COLUMN submission_fingerprint SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_accepted_reservation_unique
  ON booking_requests (accepted_reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_property_submission_key_unique
  ON booking_requests (property_id, submission_idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_setup_intent_unique
  ON booking_requests (setup_intent_id);
CREATE INDEX IF NOT EXISTS booking_requests_property_status_idx
  ON booking_requests (property_id, status);

CREATE TABLE IF NOT EXISTS booking_request_consequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
  kind varchar(50) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_request_consequences_property_request_kind_unique
  ON booking_request_consequences (property_id, booking_request_id, kind);

-- A persisted Booking Request consequence is also the stable logical identity
-- of its external webhook. Existing legacy deliveries remain NULL and continue
-- to use their delivery-row ids.
ALTER TABLE IF EXISTS webhook_deliveries
  ADD COLUMN IF NOT EXISTS logical_event_id uuid;
DO $$ BEGIN
  IF to_regclass('webhook_deliveries') IS NOT NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_property_subscription_logical_event_unique ON webhook_deliveries (property_id, subscription_id, logical_event_id)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_request_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
  label varchar(200) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  fixed_amount numeric(12,2),
  percentage numeric(5,2),
  resolved_amount numeric(12,2),
  due_milestone booking_request_installment_milestone NOT NULL DEFAULT 'manual',
  due_date date,
  allocated_amount numeric(12,2) NOT NULL DEFAULT 0,
  status booking_request_installment_status NOT NULL DEFAULT 'unpaid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_request_installments_property_request_idx
  ON booking_request_installments (property_id, booking_request_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_request_id uuid;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar(255);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_id_fkey') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_booking_request_id_fkey
      FOREIGN KEY (booking_request_id) REFERENCES booking_requests(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_property_idempotency_key_unique
  ON payments (property_id, idempotency_key);

-- Verify rather than repair legacy rows. A failed verification leaves data
-- untouched and makes the required migration action explicit to operators.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM payments
    WHERE folio_id IS NULL
      AND house_account_id IS NULL
      AND booking_request_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add payments_financial_target_check: legacy payment rows have no folio, house account, or booking request target';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_financial_target_check') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_financial_target_check
      CHECK (folio_id IS NOT NULL OR house_account_id IS NOT NULL OR booking_request_id IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_request_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  installment_id uuid NOT NULL REFERENCES booking_request_installments(id),
  amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_request_payment_allocations_payment_installment_unique
  ON booking_request_payment_allocations (payment_id, installment_id);
CREATE INDEX IF NOT EXISTS booking_request_payment_allocations_property_request_idx
  ON booking_request_payment_allocations (property_id, booking_request_id);

CREATE TABLE IF NOT EXISTS booking_request_payment_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  type booking_request_payment_resolution_type NOT NULL,
  amount numeric(12,2) NOT NULL,
  reason text,
  resolved_by uuid,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_request_payment_resolutions_property_request_idx
  ON booking_request_payment_resolutions (property_id, booking_request_id);

CREATE TABLE IF NOT EXISTS booking_request_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
  kind booking_request_email_delivery_kind NOT NULL,
  status booking_request_email_delivery_status NOT NULL DEFAULT 'pending',
  recipient varchar(255) NOT NULL,
  subject varchar(500) NOT NULL,
  body_text text NOT NULL,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_request_email_deliveries_property_request_idx
  ON booking_request_email_deliveries (property_id, booking_request_id);
