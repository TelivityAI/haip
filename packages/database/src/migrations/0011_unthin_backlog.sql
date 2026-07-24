-- Un-thin backlog: discrepancy cases, L&F categories, folio inbound idempotency,
-- turnaways, waitlist, loyalty ledger.

-- A1: HK observation on rooms + persisted discrepancy cases
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hk_occupancy') THEN
    CREATE TYPE hk_occupancy AS ENUM ('unknown', 'vacant', 'occupied');
  END IF;
END $$;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS hk_occupancy hk_occupancy NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS hk_observed_persons integer,
  ADD COLUMN IF NOT EXISTS hk_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hk_observed_by uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_discrepancy_kind') THEN
    CREATE TYPE room_discrepancy_kind AS ENUM (
      'fo_occupied_hk_vacant',
      'fo_vacant_hk_occupied',
      'person_count_mismatch',
      'occupied_without_reservation',
      'vacant_with_in_house_reservation'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_discrepancy_status') THEN
    CREATE TYPE room_discrepancy_status AS ENUM ('open', 'resolved', 'dismissed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS room_discrepancy_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  business_date date NOT NULL,
  kind room_discrepancy_kind NOT NULL,
  status room_discrepancy_status NOT NULL DEFAULT 'open',
  reservation_id uuid REFERENCES reservations(id),
  resolution_action varchar(80),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS room_discrepancy_cases_property_date_idx
  ON room_discrepancy_cases (property_id, business_date, status);

-- A2: lost & found categories (item tickets)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lost_and_found_category') THEN
    CREATE TYPE lost_and_found_category AS ENUM ('general', 'baggage', 'parcel', 'valet');
  END IF;
END $$;

ALTER TABLE lost_and_found_items
  ADD COLUMN IF NOT EXISTS category lost_and_found_category NOT NULL DEFAULT 'general';

-- A3: folio inbound idempotency
CREATE TABLE IF NOT EXISTS folio_inbound_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  vendor_txn_id varchar(120) NOT NULL,
  charge_id uuid REFERENCES charges(id),
  room_number varchar(20) NOT NULL,
  charge_type varchar(40) NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency_code varchar(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, vendor_txn_id)
);

-- B1: turnaways
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'turnaway_type') THEN
    CREATE TYPE turnaway_type AS ENUM ('denial', 'regret');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS turnaway_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  code varchar(40) NOT NULL,
  description varchar(255) NOT NULL,
  type turnaway_type NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS turnaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  arrival_date date NOT NULL,
  nights integer NOT NULL DEFAULT 1,
  rooms_requested integer NOT NULL DEFAULT 1,
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  room_type_id uuid REFERENCES room_types(id),
  rate_plan_id uuid REFERENCES rate_plans(id),
  reason_code_id uuid REFERENCES turnaway_reason_codes(id),
  type turnaway_type NOT NULL,
  channel varchar(60),
  quoted_rate_amount numeric(12, 2),
  currency_code varchar(3),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS turnaways_property_arrival_idx
  ON turnaways (property_id, arrival_date);

-- B2: waitlist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'waitlist_entry_status') THEN
    CREATE TYPE waitlist_entry_status AS ENUM ('active', 'offered', 'converted', 'cancelled', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  status waitlist_entry_status NOT NULL DEFAULT 'active',
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  rooms_requested integer NOT NULL DEFAULT 1,
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  room_type_id uuid REFERENCES room_types(id),
  rate_plan_id uuid REFERENCES rate_plans(id),
  priority integer NOT NULL DEFAULT 0,
  guest_name varchar(200),
  contact_email varchar(255),
  contact_phone varchar(50),
  notes text,
  offer_expires_at timestamptz,
  converted_reservation_id uuid REFERENCES reservations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_entries_property_status_idx
  ON waitlist_entries (property_id, status, arrival_date);

-- C1: loyalty ledger
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name varchar(120) NOT NULL,
  points_per_night integer NOT NULL DEFAULT 100,
  delay_days integer NOT NULL DEFAULT 3,
  earn_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid NOT NULL REFERENCES loyalty_programs(id),
  guest_id uuid NOT NULL REFERENCES guests(id),
  available_points integer NOT NULL DEFAULT 0,
  pending_points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, guest_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_tx_type') THEN
    CREATE TYPE loyalty_tx_type AS ENUM ('earn', 'burn', 'adjust', 'expire', 'release');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  property_id uuid REFERENCES properties(id),
  account_id uuid NOT NULL REFERENCES loyalty_accounts(id),
  type loyalty_tx_type NOT NULL,
  points integer NOT NULL,
  reservation_id uuid REFERENCES reservations(id),
  folio_id uuid REFERENCES folios(id),
  note text,
  available_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loyalty_transactions_account_idx
  ON loyalty_transactions (account_id, created_at);
