-- Connect LLM / agent hosted payment sessions (Ligare Hotels).
-- Tracks pending → paid/failed/expired with idempotency and PSP event dedupe.

CREATE TABLE IF NOT EXISTS connect_payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  confirmation_number varchar(64) NOT NULL,
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  folio_id uuid REFERENCES folios(id),
  payment_id uuid REFERENCES payments(id),
  idempotency_key varchar(200) NOT NULL,
  request_hash varchar(64) NOT NULL,
  payment_mode varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  psp varchar(40) NOT NULL,
  psp_session_id varchar(200),
  payment_url text,
  deposit_amount numeric(12, 2) NOT NULL DEFAULT 0,
  currency_code varchar(3) NOT NULL DEFAULT 'EUR',
  client_platform varchar(40),
  psp_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_payment_sessions_mode_chk
    CHECK (payment_mode IN ('charge', 'authorize', 'guarantee')),
  CONSTRAINT connect_payment_sessions_status_chk
    CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'voided'))
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_payment_sessions_idempotency_uq
  ON connect_payment_sessions (property_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS connect_payment_sessions_confirmation_uq
  ON connect_payment_sessions (confirmation_number);

CREATE INDEX IF NOT EXISTS connect_payment_sessions_pending_expiry_idx
  ON connect_payment_sessions (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS connect_payment_sessions_property_idx
  ON connect_payment_sessions (property_id);
