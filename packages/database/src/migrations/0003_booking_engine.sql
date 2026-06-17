-- Booking Engine — guest-facing direct (commission-free) booking.
-- Publishable keys (mirrors connect_credentials, but a SEPARATE lower-trust table)
-- + one config row per property. Reservations created here reuse the existing
-- booking_source value 'direct' with channel_code='booking_engine' — no new enum.

CREATE TABLE IF NOT EXISTS booking_engine_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  label varchar(200) NOT NULL,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(16),
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS booking_engine_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL UNIQUE REFERENCES properties(id),
  is_enabled boolean NOT NULL DEFAULT false,
  display_name varchar(200),
  logo_media_id uuid,
  primary_color varchar(9),
  accent_color varchar(9),
  sellable_room_type_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  sellable_rate_plan_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  deposit_policy jsonb NOT NULL DEFAULT '{"type":"first_night","refundable":true}'::jsonb,
  auto_confirm boolean NOT NULL DEFAULT false,
  stripe_publishable_key varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
