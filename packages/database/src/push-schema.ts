/**
 * Push schema to database using drizzle-orm's migrate API.
 * Workaround for drizzle-kit CJS/.js extension issue.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index.js';
import { INTEGRATION_REGISTRY_SEED } from './schema/integration-registry-seed.js';
import { postgresOptionsFromEnv } from './postgres-options.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

async function main() {
  const client = postgres(DATABASE_URL, postgresOptionsFromEnv());
  const db = drizzle(client, { schema });

  // Create enums
  const enums = [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_status') THEN CREATE TYPE room_status AS ENUM ('vacant_clean','vacant_dirty','clean','inspected','guest_ready','occupied','out_of_order','out_of_service'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vip_level') THEN CREATE TYPE vip_level AS ENUM ('none','silver','gold','platinum','diamond'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN CREATE TYPE reservation_status AS ENUM ('pending','confirmed','assigned','checked_in','stayover','due_out','checked_out','no_show','cancelled'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_source') THEN CREATE TYPE booking_source AS ENUM ('direct','ota','gds','phone','walk_in','agent','group','corporate'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rate_plan_type') THEN CREATE TYPE rate_plan_type AS ENUM ('bar','derived','negotiated','package','promotional'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'folio_type') THEN CREATE TYPE folio_type AS ENUM ('guest','master','city_ledger'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'folio_status') THEN CREATE TYPE folio_status AS ENUM ('open','settled','closed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'charge_type') THEN CREATE TYPE charge_type AS ENUM ('room','tax','food_beverage','minibar','phone','laundry','parking','spa','incidental','fee','adjustment','package'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN CREATE TYPE payment_method AS ENUM ('credit_card','debit_card','cash','bank_transfer','pix','city_ledger','vcc','other'); END IF; END $$`,
    // Idempotent add: append pix for DBs that already had payment_method without it
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'payment_method' AND e.enumlabel = 'pix') THEN ALTER TYPE payment_method ADD VALUE 'pix'; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN CREATE TYPE payment_status AS ENUM ('pending','authorized','captured','settled','refunded','partially_refunded','failed','voided'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_status') THEN CREATE TYPE booking_request_status AS ENUM ('pending','accepted','denied'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_price_source') THEN CREATE TYPE booking_request_price_source AS ENUM ('submitted','current','custom'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_installment_milestone') THEN CREATE TYPE booking_request_installment_milestone AS ENUM ('date','arrival','checkout','manual'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_installment_status') THEN CREATE TYPE booking_request_installment_status AS ENUM ('unpaid','partial','paid'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_payment_resolution_type') THEN CREATE TYPE booking_request_payment_resolution_type AS ENUM ('refund','external_return','retained'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_email_delivery_kind') THEN CREATE TYPE booking_request_email_delivery_kind AS ENUM ('receipt','accepted','denied','payment','refund','failure'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_request_email_delivery_status') THEN CREATE TYPE booking_request_email_delivery_status AS ENUM ('pending','processing','sent','failed'); END IF; END $$`,
    `ALTER TYPE booking_request_email_delivery_status ADD VALUE IF NOT EXISTS 'processing'`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'housekeeping_task_status') THEN CREATE TYPE housekeeping_task_status AS ENUM ('pending','assigned','in_progress','completed','inspected','skipped'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'housekeeping_task_type') THEN CREATE TYPE housekeeping_task_type AS ENUM ('checkout','stayover','deep_clean','inspection','turndown','maintenance'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hk_occupancy') THEN CREATE TYPE hk_occupancy AS ENUM ('unknown','vacant','occupied'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_discrepancy_kind') THEN CREATE TYPE room_discrepancy_kind AS ENUM ('fo_occupied_hk_vacant','fo_vacant_hk_occupied','person_count_mismatch','occupied_without_reservation','vacant_with_in_house_reservation'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_discrepancy_status') THEN CREATE TYPE room_discrepancy_status AS ENUM ('open','resolved','dismissed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lost_and_found_category') THEN CREATE TYPE lost_and_found_category AS ENUM ('general','baggage','parcel','valet'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lost_and_found_status') THEN CREATE TYPE lost_and_found_status AS ENUM ('held','returned','disposed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_status') THEN CREATE TYPE service_request_status AS ENUM ('open','in_progress','done','cancelled'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_type') THEN CREATE TYPE service_request_type AS ENUM ('maintenance','turndown','deep_clean','checkout','stayover','inspection','service_request'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'turnaway_type') THEN CREATE TYPE turnaway_type AS ENUM ('denial','regret'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'waitlist_entry_status') THEN CREATE TYPE waitlist_entry_status AS ENUM ('active','offered','converted','cancelled','expired'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_tx_type') THEN CREATE TYPE loyalty_tx_type AS ENUM ('earn','burn','adjust','expire','release'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_run_status') THEN CREATE TYPE audit_run_status AS ENUM ('running','completed','failed','rolled_back'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_status') THEN CREATE TYPE channel_status AS ENUM ('active','inactive','error','pending_setup'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_direction') THEN CREATE TYPE sync_direction AS ENUM ('push','pull','bidirectional'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_rule_type') THEN CREATE TYPE tax_rule_type AS ENUM ('percentage','flat_per_night','flat_per_stay','split_component'); END IF; END $$`,
    // Idempotent add: append split_component to tax_rule_type if it already existed without it
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'tax_rule_type' AND e.enumlabel = 'split_component') THEN ALTER TYPE tax_rule_type ADD VALUE 'split_component'; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_source') THEN CREATE TYPE review_source AS ENUM ('google','tripadvisor','booking_com','expedia','other'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_response_status') THEN CREATE TYPE review_response_status AS ENUM ('pending','drafted','approved','posted'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_type') THEN CREATE TYPE agent_type AS ENUM ('pricing','demand_forecast','channel_mix','overbooking','night_audit','housekeeping','cancellation','guest_comms','review_response','ar_collections','deposit_risk','group_pickup','revenue_manager'); END IF; END $$`,
    // Idempotent add: append ar_collections / deposit_risk to agent_type if it already existed without them
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'agent_type' AND e.enumlabel = 'ar_collections') THEN ALTER TYPE agent_type ADD VALUE 'ar_collections'; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'agent_type' AND e.enumlabel = 'deposit_risk') THEN ALTER TYPE agent_type ADD VALUE 'deposit_risk'; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'agent_type' AND e.enumlabel = 'group_pickup') THEN ALTER TYPE agent_type ADD VALUE 'group_pickup'; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'agent_type' AND e.enumlabel = 'revenue_manager') THEN ALTER TYPE agent_type ADD VALUE 'revenue_manager'; END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_mode') THEN CREATE TYPE agent_mode AS ENUM ('manual','suggest','autopilot'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_decision_status') THEN CREATE TYPE agent_decision_status AS ENUM ('pending','approved','rejected','auto_executed','expired'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_delivery_status') THEN CREATE TYPE webhook_delivery_status AS ENUM ('pending','delivered','failed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_catalog_status') THEN CREATE TYPE integration_catalog_status AS ENUM ('shipped','recipe','adapter','planned'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deposit_status') THEN CREATE TYPE deposit_status AS ENUM ('held','applied','refunded','forfeited'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ar_ledger_status') THEN CREATE TYPE ar_ledger_status AS ENUM ('open','closed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ar_txn_type') THEN CREATE TYPE ar_txn_type AS ENUM ('transfer_in','payment','reverse_transfer','adjustment'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_session_status') THEN CREATE TYPE cash_session_status AS ENUM ('open','closed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_movement_type') THEN CREATE TYPE cash_movement_type AS ENUM ('payment','refund','paid_out','drop'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_code_kind') THEN CREATE TYPE accounting_code_kind AS ENUM ('transaction','gl'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'house_account_kind') THEN CREATE TYPE house_account_kind AS ENUM ('retail','vendor','internal','other'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'house_account_status') THEN CREATE TYPE house_account_status AS ENUM ('open','closed'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'folio_target_role') THEN CREATE TYPE folio_target_role AS ENUM ('guest','company'); END IF; END $$`,
    // Groups & Allotment Engine (KB 14.3–14.7)
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'group_type') THEN CREATE TYPE group_type AS ENUM ('corporate','travel_agent','wholesale','event','other'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'block_status') THEN CREATE TYPE block_status AS ENUM ('tentative','definite','released','cancelled'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rooming_list_entry_status') THEN CREATE TYPE rooming_list_entry_status AS ENUM ('pending','created','error'); END IF; END $$`,
    // Media (images for property / room types / rooms)
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_owner_type') THEN CREATE TYPE media_owner_type AS ENUM ('property','room_type','room'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_category') THEN CREATE TYPE media_category AS ENUM ('hero','exterior','room','amenity','dining','other'); END IF; END $$`,
    // RBAC (local authz + Keycloak login)
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN CREATE TYPE user_status AS ENUM ('active','disabled','invited'); END IF; END $$`,
    // Stay extras / packages
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_posting_rule') THEN CREATE TYPE service_posting_rule AS ENUM ('once','per_night','on_consumption','included_in_rate'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_service_status') THEN CREATE TYPE reservation_service_status AS ENUM ('quoted','confirmed','posted','cancelled'); END IF; END $$`,
    // PMS migration engine
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migration_job_status') THEN CREATE TYPE migration_job_status AS ENUM ('pending','running','completed','failed','paused'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migration_row_status') THEN CREATE TYPE migration_row_status AS ENUM ('pending','succeeded','failed','skipped'); END IF; END $$`,
    // Cancellation policies
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_penalty_type') THEN CREATE TYPE cancellation_penalty_type AS ENUM ('none','first_night','percentage','full'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancellation_deposit_handling') THEN CREATE TYPE cancellation_deposit_handling AS ENUM ('refund_if_refundable','always_forfeit','always_refund'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'door_lock_credential_status') THEN CREATE TYPE door_lock_credential_status AS ENUM ('active','revoked'); END IF; END $$`,
  ];

  for (const e of enums) {
    await db.execute(sql.raw(e));
  }

  // Create tables
  const tables = [
    // properties
    `CREATE TABLE IF NOT EXISTS properties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      code varchar(20) NOT NULL UNIQUE,
      description text,
      address_line_1 varchar(255),
      address_line_2 varchar(255),
      city varchar(100),
      state_province varchar(100),
      postal_code varchar(20),
      country_code varchar(2) NOT NULL,
      timezone varchar(50) NOT NULL,
      currency_code varchar(3) NOT NULL,
      default_language varchar(5) NOT NULL DEFAULT 'en',
      star_rating integer,
      total_rooms integer NOT NULL,
      phone varchar(30),
      email varchar(255),
      website varchar(500),
      tax_jurisdiction varchar(100),
      guest_registration_required boolean NOT NULL DEFAULT true,
      guest_registration_config jsonb,
      gds_chain_code varchar(4),
      gds_property_id varchar(20),
      check_in_time varchar(5) NOT NULL DEFAULT '15:00',
      check_out_time varchar(5) NOT NULL DEFAULT '11:00',
      overbooking_percentage integer NOT NULL DEFAULT 0,
      night_audit_time varchar(5) NOT NULL DEFAULT '02:00',
      settings jsonb,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // room_types
    `CREATE TABLE IF NOT EXISTS room_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(100) NOT NULL,
      code varchar(20) NOT NULL,
      description text,
      max_occupancy integer NOT NULL,
      default_occupancy integer NOT NULL,
      bed_type varchar(50),
      bed_count integer NOT NULL DEFAULT 1,
      square_meters integer,
      floor varchar(10),
      is_accessible boolean NOT NULL DEFAULT false,
      amenities jsonb,
      sort_order integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // rooms
    `CREATE TABLE IF NOT EXISTS rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      room_type_id uuid NOT NULL REFERENCES room_types(id),
      number varchar(20) NOT NULL,
      floor varchar(10),
      building varchar(50),
      status room_status NOT NULL DEFAULT 'vacant_clean',
      is_accessible boolean NOT NULL DEFAULT false,
      is_connecting boolean NOT NULL DEFAULT false,
      connecting_room_id uuid,
      amenities jsonb,
      maintenance_notes text,
      last_inspected_at timestamptz,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // guests
    `CREATE TABLE IF NOT EXISTS guests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name varchar(100) NOT NULL,
      last_name varchar(100) NOT NULL,
      email varchar(255),
      phone varchar(30),
      id_type varchar(30),
      id_number varchar(50),
      id_country varchar(2),
      id_expiry timestamptz,
      nationality varchar(2),
      date_of_birth timestamp,
      gender varchar(20),
      profession varchar(100),
      tax_id varchar(50),
      registration_data jsonb,
      address_line_1 varchar(255),
      address_line_2 varchar(255),
      city varchar(100),
      state_province varchar(100),
      postal_code varchar(20),
      country_code varchar(2),
      vip_level vip_level NOT NULL DEFAULT 'none',
      company_name varchar(255),
      loyalty_number varchar(50),
      preferences jsonb,
      is_dnr boolean NOT NULL DEFAULT false,
      dnr_reason text,
      dnr_date timestamptz,
      gdpr_consent_marketing boolean NOT NULL DEFAULT false,
      gdpr_consent_date timestamptz,
      gdpr_data_retention_override timestamptz,
      notes text,
      is_deleted boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE guests ADD COLUMN IF NOT EXISTS gender varchar(20)`,
    `ALTER TABLE guests ADD COLUMN IF NOT EXISTS profession varchar(100)`,
    `ALTER TABLE guests ADD COLUMN IF NOT EXISTS tax_id varchar(50)`,
    `ALTER TABLE guests ADD COLUMN IF NOT EXISTS registration_data jsonb`,
    // rate_plans
    `CREATE TABLE IF NOT EXISTS rate_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      room_type_id uuid NOT NULL REFERENCES room_types(id),
      name varchar(100) NOT NULL,
      code varchar(20) NOT NULL,
      description text,
      type rate_plan_type NOT NULL,
      base_amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      parent_rate_plan_id uuid,
      derived_adjustment_type varchar(10),
      derived_adjustment_value numeric(8,2),
      is_tax_inclusive boolean NOT NULL DEFAULT false,
      cancellation_policy_id uuid,
      meal_plan varchar(20),
      valid_from date,
      valid_to date,
      is_active boolean NOT NULL DEFAULT true,
      channel_codes jsonb,
      los_adjustments jsonb,
      occupancy_bands jsonb,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // rate_restrictions
    `CREATE TABLE IF NOT EXISTS rate_restrictions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
      start_date date NOT NULL,
      end_date date NOT NULL,
      min_los integer,
      max_los integer,
      closed_to_arrival boolean NOT NULL DEFAULT false,
      closed_to_departure boolean NOT NULL DEFAULT false,
      is_closed boolean NOT NULL DEFAULT false,
      rate_override numeric(12,2),
      day_of_week_overrides jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // bookings
    `CREATE TABLE IF NOT EXISTS bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      guest_id uuid NOT NULL REFERENCES guests(id),
      confirmation_number varchar(50) NOT NULL UNIQUE,
      external_confirmation varchar(100),
      source booking_source NOT NULL,
      channel_code varchar(50),
      group_id uuid,
      group_name varchar(255),
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // reservations
    `CREATE TABLE IF NOT EXISTS reservations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      booking_id uuid NOT NULL REFERENCES bookings(id),
      guest_id uuid NOT NULL REFERENCES guests(id),
      arrival_date date NOT NULL,
      departure_date date NOT NULL,
      nights integer NOT NULL,
      room_type_id uuid NOT NULL REFERENCES room_types(id),
      room_id uuid REFERENCES rooms(id),
      status reservation_status NOT NULL DEFAULT 'pending',
      rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
      total_amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      adults integer NOT NULL DEFAULT 1,
      children integer NOT NULL DEFAULT 0,
      special_requests text,
      preferences jsonb,
      checked_in_at timestamptz,
      checked_out_at timestamptz,
      checked_in_by uuid,
      checked_out_by uuid,
      cancelled_at timestamptz,
      cancellation_reason text,
      registration_data jsonb,
      registration_submitted_at timestamptz,
      guest_id_document jsonb,
      actual_arrival_time timestamptz,
      actual_departure_time timestamptz,
      is_early_checkin boolean NOT NULL DEFAULT false,
      is_late_checkout boolean NOT NULL DEFAULT false,
      early_checkin_fee numeric(12,2),
      late_checkout_fee numeric(12,2),
      registration_signed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS do_not_move boolean NOT NULL DEFAULT false`,
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS accepted_pricing_snapshot jsonb`,
    // folios
    `CREATE TABLE IF NOT EXISTS folios (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid REFERENCES reservations(id),
      booking_id uuid REFERENCES bookings(id),
      guest_id uuid NOT NULL REFERENCES guests(id),
      folio_number varchar(50) NOT NULL,
      type folio_type NOT NULL DEFAULT 'guest',
      status folio_status NOT NULL DEFAULT 'open',
      total_charges numeric(12,2) NOT NULL DEFAULT 0,
      total_payments numeric(12,2) NOT NULL DEFAULT 0,
      balance numeric(12,2) NOT NULL DEFAULT 0,
      currency_code varchar(3) NOT NULL,
      company_name varchar(255),
      billing_address text,
      payment_terms_days varchar(10),
      notes text,
      settled_at timestamptz,
      closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // charges
    `CREATE TABLE IF NOT EXISTS charges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      folio_id uuid NOT NULL REFERENCES folios(id),
      type charge_type NOT NULL,
      description varchar(255) NOT NULL,
      amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      tax_amount numeric(12,2) NOT NULL DEFAULT 0,
      tax_rate numeric(5,4),
      tax_code varchar(20),
      service_date timestamptz NOT NULL,
      is_reversal boolean NOT NULL DEFAULT false,
      original_charge_id uuid,
      parent_charge_id uuid REFERENCES charges(id),
      source_key varchar(255),
      is_locked boolean NOT NULL DEFAULT false,
      locked_by_audit_date timestamp,
      posted_by uuid,
      posted_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // payments
    `CREATE TABLE IF NOT EXISTS payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      folio_id uuid NOT NULL REFERENCES folios(id),
      method payment_method NOT NULL,
      status payment_status NOT NULL DEFAULT 'pending',
      amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      gateway_provider varchar(20),
      gateway_transaction_id varchar(255),
      gateway_payment_token varchar(255),
      card_last_four varchar(4),
      card_brand varchar(20),
      is_pre_authorization boolean NOT NULL DEFAULT false,
      pre_auth_expires_at timestamptz,
      original_payment_id uuid,
      notes text,
      processed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // housekeeping_tasks
    `CREATE TABLE IF NOT EXISTS housekeeping_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      room_id uuid NOT NULL REFERENCES rooms(id),
      type housekeeping_task_type NOT NULL,
      status housekeeping_task_status NOT NULL DEFAULT 'pending',
      priority integer NOT NULL DEFAULT 0,
      assigned_to uuid,
      assigned_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      inspected_by uuid,
      inspected_at timestamptz,
      checklist jsonb,
      notes text,
      maintenance_required boolean NOT NULL DEFAULT false,
      maintenance_notes text,
      service_date timestamp NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // lost_and_found_items
    `CREATE TABLE IF NOT EXISTS lost_and_found_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      room_id uuid REFERENCES rooms(id),
      reservation_id uuid REFERENCES reservations(id),
      guest_id uuid REFERENCES guests(id),
      category lost_and_found_category NOT NULL DEFAULT 'general',
      description text NOT NULL,
      tag_code varchar(50) NOT NULL,
      status lost_and_found_status NOT NULL DEFAULT 'held',
      found_at timestamptz NOT NULL DEFAULT now(),
      dispose_after timestamptz NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS lost_and_found_items_property_status_idx ON lost_and_found_items (property_id, status)`,
    // demand capture
    `CREATE TABLE IF NOT EXISTS turnaway_reason_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      code varchar(40) NOT NULL,
      description varchar(255) NOT NULL,
      type turnaway_type NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS turnaways (
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
      quoted_rate_amount numeric(12,2),
      currency_code varchar(3),
      comment text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS turnaways_property_arrival_idx ON turnaways (property_id, arrival_date)`,
    `CREATE TABLE IF NOT EXISTS waitlist_entries (
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
    )`,
    `CREATE INDEX IF NOT EXISTS waitlist_entries_property_status_idx ON waitlist_entries (property_id, status)`,
    `CREATE TABLE IF NOT EXISTS folio_inbound_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      vendor_txn_id varchar(120) NOT NULL,
      charge_id uuid REFERENCES charges(id),
      room_number varchar(20) NOT NULL,
      charge_type varchar(40) NOT NULL,
      amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL DEFAULT 'USD',
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS folio_inbound_posts_property_vendor_unique ON folio_inbound_posts (property_id, vendor_txn_id)`,
    // room_discrepancy_cases (A1 — Skip/Sleep workflow)
    `CREATE TABLE IF NOT EXISTS room_discrepancy_cases (
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
    )`,
    `CREATE INDEX IF NOT EXISTS room_discrepancy_cases_property_date_idx
      ON room_discrepancy_cases (property_id, business_date, status)`,
    // service_requests
    `CREATE TABLE IF NOT EXISTS service_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      room_id uuid REFERENCES rooms(id),
      reservation_id uuid REFERENCES reservations(id),
      type service_request_type NOT NULL,
      priority integer NOT NULL DEFAULT 0,
      status service_request_status NOT NULL DEFAULT 'open',
      title varchar(255) NOT NULL,
      description text,
      linked_task_id uuid REFERENCES housekeeping_tasks(id),
      requested_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS service_requests_property_status_idx ON service_requests (property_id, status)`,
    // audit_runs
    `CREATE TABLE IF NOT EXISTS audit_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      business_date date NOT NULL,
      status audit_run_status NOT NULL DEFAULT 'running',
      room_charges_posted numeric(12,2),
      tax_charges_posted numeric(12,2),
      no_shows_processed numeric(4,0),
      summary jsonb,
      errors jsonb,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS night_audit_runs_property_date_unique ON audit_runs (property_id, business_date)`,
    // audit_logs
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid REFERENCES properties(id),
      action varchar(50) NOT NULL,
      entity_type varchar(50) NOT NULL,
      entity_id uuid,
      user_id uuid,
      user_email varchar(255),
      ip_address varchar(45),
      previous_value jsonb,
      new_value jsonb,
      description text,
      occurred_at timestamptz NOT NULL DEFAULT now()
    )`,
    // channel_connections
    `CREATE TABLE IF NOT EXISTS channel_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      channel_code varchar(50) NOT NULL,
      channel_name varchar(100) NOT NULL,
      adapter_type varchar(50) NOT NULL,
      status channel_status NOT NULL DEFAULT 'pending_setup',
      sync_direction sync_direction NOT NULL DEFAULT 'bidirectional',
      config jsonb,
      rate_plan_mapping jsonb,
      room_type_mapping jsonb,
      last_sync_at timestamptz,
      last_sync_status varchar(20),
      last_sync_error text,
      last_reservation_pull_at timestamptz,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // ari_sync_logs
    `CREATE TABLE IF NOT EXISTS ari_sync_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      channel_connection_id uuid NOT NULL REFERENCES channel_connections(id),
      direction sync_direction NOT NULL,
      action varchar(50) NOT NULL,
      payload jsonb,
      response jsonb,
      status varchar(20) NOT NULL,
      error_message text,
      room_type_id uuid,
      rate_plan_id uuid,
      date_range_start date,
      date_range_end date,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // content_sync_logs — descriptive content (photos/descriptions/amenities) pushes
    `CREATE TABLE IF NOT EXISTS content_sync_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      channel_connection_id uuid NOT NULL REFERENCES channel_connections(id),
      direction sync_direction NOT NULL DEFAULT 'push',
      action varchar(50) NOT NULL,
      payload jsonb,
      response jsonb,
      status varchar(20) NOT NULL,
      error_message text,
      room_type_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // tax_profiles
    `CREATE TABLE IF NOT EXISTS tax_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(100) NOT NULL,
      jurisdiction_code varchar(50) NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      effective_from date NOT NULL,
      effective_to date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // tax_rules
    `CREATE TABLE IF NOT EXISTS tax_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tax_profile_id uuid NOT NULL REFERENCES tax_profiles(id),
      name varchar(100) NOT NULL,
      code varchar(30) NOT NULL,
      type tax_rule_type NOT NULL,
      rate numeric(8,4) NOT NULL,
      split_percentage numeric(5,2),
      applies_to_charge_types text[],
      exemptions jsonb,
      is_compounding boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      effective_from date NOT NULL,
      effective_to date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // guest_reviews
    `CREATE TABLE IF NOT EXISTS guest_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      source review_source NOT NULL,
      guest_name varchar(200) NOT NULL,
      rating integer NOT NULL,
      review_text text NOT NULL,
      stay_date varchar(10),
      reservation_id uuid REFERENCES reservations(id),
      external_id varchar(255),
      external_url text,
      provider_place_id varchar(255),
      provider_location_id varchar(255),
      provider_channel_id varchar(255),
      last_synced_at timestamptz,
      response_status review_response_status NOT NULL DEFAULT 'pending',
      response_text text,
      responded_at timestamptz,
      responded_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // agent_configs
    `CREATE TABLE IF NOT EXISTS agent_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      agent_type agent_type NOT NULL,
      is_enabled boolean NOT NULL DEFAULT false,
      mode agent_mode NOT NULL DEFAULT 'suggest',
      autopilot_confidence_threshold numeric(3,2) DEFAULT '0.85',
      config jsonb DEFAULT '{}'::jsonb,
      model_state jsonb DEFAULT '{}'::jsonb,
      last_trained_at timestamptz,
      last_run_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS agent_configs_property_agent_unique ON agent_configs (property_id, agent_type)`,
    // agent_decisions
    `CREATE TABLE IF NOT EXISTS agent_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      agent_type agent_type NOT NULL,
      decision_type varchar(100) NOT NULL,
      input_snapshot jsonb DEFAULT '{}'::jsonb,
      recommendation jsonb DEFAULT '{}'::jsonb,
      confidence numeric(3,2) NOT NULL,
      status agent_decision_status NOT NULL DEFAULT 'pending',
      approved_by uuid,
      executed_at timestamptz,
      outcome jsonb,
      outcome_recorded_at timestamptz,
      explanation jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // HAIP AI explanation column (idempotent for DBs predating this column)
    `ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS explanation jsonb`,
    // agent_training_snapshots
    `CREATE TABLE IF NOT EXISTS agent_training_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      agent_type agent_type NOT NULL,
      snapshot_date date NOT NULL,
      data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // agent_webhook_subscriptions
    `CREATE TABLE IF NOT EXISTS agent_webhook_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      subscriber_id varchar(100) NOT NULL,
      subscriber_name varchar(200),
      callback_url varchar(500) NOT NULL,
      events jsonb NOT NULL,
      secret varchar(200),
      is_active boolean NOT NULL DEFAULT true,
      last_delivery_at timestamptz,
      last_delivery_status varchar(20),
      failure_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // webhook_deliveries
    `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      subscription_id uuid NOT NULL REFERENCES agent_webhook_subscriptions(id),
      logical_event_id uuid,
      event_type varchar(100) NOT NULL,
      payload jsonb NOT NULL,
      status webhook_delivery_status NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      last_attempt_at timestamptz,
      next_retry_at timestamptz,
      last_status_code integer,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz
    )`,
    // PMS migration engine — durable batch import + legacy id map
    `CREATE TABLE IF NOT EXISTS migration_legacy_id_map (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      project_id varchar(120) NOT NULL,
      entity varchar(80) NOT NULL,
      legacy_id varchar(120) NOT NULL,
      haip_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS migration_legacy_id_map_project_entity_legacy_unique
      ON migration_legacy_id_map (property_id, project_id, entity, legacy_id)`,
    `CREATE TABLE IF NOT EXISTS migration_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      project_id varchar(120) NOT NULL,
      entity varchar(80) NOT NULL,
      status migration_job_status NOT NULL DEFAULT 'pending',
      dry_run boolean NOT NULL DEFAULT false,
      payload jsonb NOT NULL,
      checkpoint_cursor integer NOT NULL DEFAULT 0,
      total_rows integer NOT NULL DEFAULT 0,
      processed_rows integer NOT NULL DEFAULT 0,
      succeeded_rows integer NOT NULL DEFAULT 0,
      failed_rows integer NOT NULL DEFAULT 0,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      next_retry_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz
    )`,
    `CREATE TABLE IF NOT EXISTS migration_row_results (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES migration_jobs(id),
      property_id uuid NOT NULL REFERENCES properties(id),
      row_index integer NOT NULL,
      status migration_row_status NOT NULL DEFAULT 'pending',
      legacy_id varchar(120),
      haip_id uuid,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS migration_row_results_job_row_unique
      ON migration_row_results (job_id, row_index)`,
    // Integration catalog (global) + per-property enablement.
    `CREATE TABLE IF NOT EXISTS integration_catalog_entries (
      slug varchar(120) PRIMARY KEY,
      category varchar(80) NOT NULL,
      name varchar(160) NOT NULL,
      status integration_catalog_status NOT NULL,
      docs_path text,
      adapter_key varchar(80),
      description varchar(300) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS integration_catalog_entries_category_idx ON integration_catalog_entries (category)`,
    `CREATE INDEX IF NOT EXISTS integration_catalog_entries_status_idx ON integration_catalog_entries (status)`,
    `CREATE TABLE IF NOT EXISTS property_integrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      catalog_slug varchar(120) NOT NULL REFERENCES integration_catalog_entries(slug),
      enabled boolean NOT NULL DEFAULT true,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS property_integrations_property_catalog_idx ON property_integrations (property_id, catalog_slug)`,
    `CREATE INDEX IF NOT EXISTS property_integrations_property_idx ON property_integrations (property_id)`,
    // deposit_ledger_entries (KB 10)
    `CREATE TABLE IF NOT EXISTS deposit_ledger_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid REFERENCES reservations(id),
      payment_id uuid REFERENCES payments(id),
      amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      status deposit_status NOT NULL DEFAULT 'held',
      is_refundable boolean NOT NULL DEFAULT true,
      received_at timestamptz NOT NULL DEFAULT now(),
      recognized_at timestamptz,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // ar_ledgers (KB 11)
    `CREATE TABLE IF NOT EXISTS ar_ledgers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(255) NOT NULL,
      description text,
      payment_terms_days varchar(10),
      status ar_ledger_status NOT NULL DEFAULT 'open',
      balance numeric(12,2) NOT NULL DEFAULT 0,
      currency_code varchar(3) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // ar_transactions (KB 11)
    `CREATE TABLE IF NOT EXISTS ar_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      ar_ledger_id uuid NOT NULL REFERENCES ar_ledgers(id),
      type ar_txn_type NOT NULL,
      amount numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      source_folio_id uuid REFERENCES folios(id),
      reversed_by_id uuid REFERENCES ar_transactions(id),
      note text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // cash_drawers (KB 12)
    `CREATE TABLE IF NOT EXISTS cash_drawers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(255) NOT NULL,
      starting_float numeric(12,2) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // cash_drawer_sessions (KB 12)
    `CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      cash_drawer_id uuid NOT NULL REFERENCES cash_drawers(id),
      cashier_user_id uuid NOT NULL,
      status cash_session_status NOT NULL DEFAULT 'open',
      opening_float numeric(12,2) NOT NULL,
      expected_balance numeric(12,2),
      counted_balance numeric(12,2),
      variance numeric(12,2),
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz
    )`,
    // cash_movements (KB 12)
    `CREATE TABLE IF NOT EXISTS cash_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      session_id uuid NOT NULL REFERENCES cash_drawer_sessions(id),
      type cash_movement_type NOT NULL,
      amount numeric(12,2) NOT NULL,
      reservation_id uuid,
      note text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // accounting_codes (KB 5)
    `CREATE TABLE IF NOT EXISTS accounting_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      kind accounting_code_kind NOT NULL,
      code varchar(50) NOT NULL,
      label varchar(255) NOT NULL,
      applies_to varchar(50),
      archived boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // house_accounts (KB 13) — property-scoped ledger, NO reservation/guest link
    `CREATE TABLE IF NOT EXISTS house_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(255) NOT NULL,
      kind house_account_kind NOT NULL DEFAULT 'retail',
      status house_account_status NOT NULL DEFAULT 'open',
      balance numeric(12,2) NOT NULL DEFAULT 0,
      total_charges numeric(12,2) NOT NULL DEFAULT 0,
      total_payments numeric(12,2) NOT NULL DEFAULT 0,
      currency_code varchar(3) NOT NULL,
      notes text,
      opened_by uuid,
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // products (KB 13.3) — retail / item catalog
    `CREATE TABLE IF NOT EXISTS products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      category varchar(100),
      name varchar(255) NOT NULL,
      price numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      tax_code varchar(20),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // folio_routing_rules (KB 14.2)
    `CREATE TABLE IF NOT EXISTS folio_routing_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid NOT NULL REFERENCES reservations(id),
      charge_type charge_type NOT NULL,
      target_folio_id uuid NOT NULL REFERENCES folios(id),
      priority integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // Groups & Allotment Engine (KB 14.3–14.7)
    `CREATE TABLE IF NOT EXISTS group_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(255) NOT NULL,
      type group_type NOT NULL DEFAULT 'corporate',
      contact_name varchar(255),
      contact_email varchar(255),
      contact_phone varchar(30),
      master_folio_id uuid REFERENCES folios(id),
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS allotment_blocks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      group_profile_id uuid NOT NULL REFERENCES group_profiles(id),
      name varchar(255) NOT NULL,
      rate_plan_id uuid REFERENCES rate_plans(id),
      start_date date NOT NULL,
      end_date date NOT NULL,
      cutoff_date date,
      auto_release boolean NOT NULL DEFAULT true,
      shoulder_start date,
      shoulder_end date,
      min_los integer,
      max_los integer,
      group_code varchar(50),
      status block_status NOT NULL DEFAULT 'tentative',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS allotment_block_inventory (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      allotment_block_id uuid NOT NULL REFERENCES allotment_blocks(id),
      stay_date date NOT NULL,
      room_type_id uuid NOT NULL REFERENCES room_types(id),
      rooms_allotted integer NOT NULL DEFAULT 0,
      rooms_picked_up integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS rooming_list_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      allotment_block_id uuid NOT NULL REFERENCES allotment_blocks(id),
      guest_name varchar(255) NOT NULL,
      arrival date,
      departure date,
      room_type_id uuid REFERENCES room_types(id),
      reservation_id uuid REFERENCES reservations(id),
      status rooming_list_entry_status NOT NULL DEFAULT 'pending',
      error_note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // reservation_notes (Tier 4 — Reservation Operations Polish)
    `CREATE TABLE IF NOT EXISTS reservation_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid NOT NULL REFERENCES reservations(id),
      body text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      author_user_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // Named occupants per reservation (primary + accompanying). Booking remains
    // the multi-room wrapper; each reservation is still one physical unit.
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_guest_role') THEN CREATE TYPE reservation_guest_role AS ENUM ('primary','accompanying'); END IF; END $$`,
    `CREATE TABLE IF NOT EXISTS reservation_guests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid NOT NULL REFERENCES reservations(id),
      guest_id uuid NOT NULL REFERENCES guests(id),
      role reservation_guest_role NOT NULL DEFAULT 'accompanying',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reservation_guests_res_guest_uidx
      ON reservation_guests (reservation_id, guest_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reservation_guests_one_primary_uidx
      ON reservation_guests (reservation_id) WHERE role = 'primary'`,
    `CREATE INDEX IF NOT EXISTS reservation_guests_property_guest_idx
      ON reservation_guests (property_id, guest_id)`,
    // Backfill primary occupant from reservations.guest_id for existing rows.
    `INSERT INTO reservation_guests (property_id, reservation_id, guest_id, role)
      SELECT r.property_id, r.id, r.guest_id, 'primary'::reservation_guest_role
      FROM reservations r
      WHERE NOT EXISTS (
        SELECT 1 FROM reservation_guests rg WHERE rg.reservation_id = r.id AND rg.guest_id = r.guest_id
      )`,
    // media — polymorphic images for property / room types / rooms
    `CREATE TABLE IF NOT EXISTS media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      owner_type media_owner_type NOT NULL,
      owner_id uuid NOT NULL,
      url text NOT NULL,
      storage_key varchar(512),
      category media_category NOT NULL DEFAULT 'other',
      caption varchar(500),
      alt_text varchar(500),
      sort_order integer NOT NULL DEFAULT 0,
      is_primary boolean NOT NULL DEFAULT false,
      width integer,
      height integer,
      content_type varchar(100),
      file_size integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS media_owner_idx ON media (owner_type, owner_id)`,
    `CREATE INDEX IF NOT EXISTS media_property_idx ON media (property_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS media_one_primary_per_owner ON media (owner_type, owner_id) WHERE is_primary = true`,
    // RBAC — local users / roles / permissions
    `CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid REFERENCES properties(id),
      keycloak_sub uuid,
      email varchar(255) NOT NULL,
      name varchar(255) NOT NULL,
      status user_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`,
    `CREATE INDEX IF NOT EXISTS users_keycloak_sub_idx ON users (keycloak_sub)`,
    `CREATE TABLE IF NOT EXISTS roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid REFERENCES properties(id),
      key varchar(50) NOT NULL,
      name varchar(100) NOT NULL,
      description text,
      is_system boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS roles_property_key_unique ON roles (property_id, key)`,
    `CREATE TABLE IF NOT EXISTS role_permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      role_id uuid NOT NULL REFERENCES roles(id),
      permission_key varchar(100) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_role_perm_unique ON role_permissions (property_id, role_id, permission_key)`,
    `CREATE TABLE IF NOT EXISTS user_roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      user_id uuid NOT NULL REFERENCES users(id),
      role_id uuid NOT NULL REFERENCES roles(id),
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_unique ON user_roles (user_id, role_id)`,
    `CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id)`,
    // Booking Engine — publishable keys + per-property config (guest-facing direct booking)
    `CREATE TABLE IF NOT EXISTS booking_engine_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      label varchar(200) NOT NULL,
      key_hash varchar(64) NOT NULL UNIQUE,
      key_prefix varchar(16),
      is_active boolean NOT NULL DEFAULT true,
      last_used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    )`,
    `CREATE TABLE IF NOT EXISTS booking_engine_config (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL UNIQUE REFERENCES properties(id),
      is_enabled boolean NOT NULL DEFAULT false,
      display_name varchar(200),
      logo_media_id uuid,
      primary_color varchar(9),
      accent_color varchar(9),
      booking_mode varchar(10) NOT NULL DEFAULT 'instant',
      payment_method_collection varchar(10) NOT NULL DEFAULT 'disabled',
      form_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
      sellable_room_type_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      sellable_rate_plan_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      deposit_policy jsonb NOT NULL DEFAULT '{"type":"first_night","refundable":true}'::jsonb,
      auto_confirm boolean NOT NULL DEFAULT false,
      stripe_publishable_key varchar(255),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // Booking Requests — separate request-first aggregate. Every row carries
    // property scope because later services must filter it with every ID.
    `CREATE TABLE IF NOT EXISTS booking_requests (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_accepted_reservation_unique ON booking_requests (accepted_reservation_id)`,
    `CREATE INDEX IF NOT EXISTS booking_requests_property_status_idx ON booking_requests (property_id, status)`,
    `CREATE TABLE IF NOT EXISTS booking_request_consequences (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_request_consequences_property_request_kind_unique ON booking_request_consequences (property_id, booking_request_id, kind)`,
    `CREATE TABLE IF NOT EXISTS booking_request_installments (
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
    )`,
    `CREATE INDEX IF NOT EXISTS booking_request_installments_property_request_idx ON booking_request_installments (property_id, booking_request_id)`,
    `CREATE TABLE IF NOT EXISTS booking_request_payment_allocations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
      payment_id uuid NOT NULL REFERENCES payments(id),
      installment_id uuid NOT NULL REFERENCES booking_request_installments(id),
      amount numeric(12,2) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_request_payment_allocations_payment_installment_unique ON booking_request_payment_allocations (payment_id, installment_id)`,
    `CREATE INDEX IF NOT EXISTS booking_request_payment_allocations_property_request_idx ON booking_request_payment_allocations (property_id, booking_request_id)`,
    `CREATE TABLE IF NOT EXISTS booking_request_payment_resolutions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
      payment_id uuid NOT NULL REFERENCES payments(id),
      type booking_request_payment_resolution_type NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'completed',
      amount numeric(12,2) NOT NULL,
      idempotency_key varchar(255),
      operation_fingerprint varchar(64),
      provider_transaction_id varchar(255),
      provider_status varchar(40),
      movement_id uuid REFERENCES payments(id),
      reason text,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      resolved_by uuid,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS booking_request_payment_resolutions_property_request_idx ON booking_request_payment_resolutions (property_id, booking_request_id)`,
    `CREATE TABLE IF NOT EXISTS booking_request_email_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
      logical_key varchar(200) NOT NULL,
      kind booking_request_email_delivery_kind NOT NULL,
      status booking_request_email_delivery_status NOT NULL DEFAULT 'pending',
      recipient varchar(255) NOT NULL,
      subject varchar(500) NOT NULL,
      body_text text NOT NULL,
      error_message text,
      attempts integer NOT NULL DEFAULT 0,
      automatic_attempts integer NOT NULL DEFAULT 0,
      claimed_at timestamptz,
      next_attempt_at timestamptz,
      last_attempt_at timestamptz,
      provider_message_id varchar(500),
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE booking_request_email_deliveries ADD COLUMN IF NOT EXISTS logical_key varchar(200)`,
    `ALTER TABLE booking_request_email_deliveries ADD COLUMN IF NOT EXISTS claimed_at timestamptz`,
    `ALTER TABLE booking_request_email_deliveries ADD COLUMN IF NOT EXISTS automatic_attempts integer NOT NULL DEFAULT 0`,
    `ALTER TABLE booking_request_email_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz`,
    `ALTER TABLE booking_request_email_deliveries ADD COLUMN IF NOT EXISTS provider_message_id varchar(500)`,
    `UPDATE booking_request_email_deliveries SET logical_key = 'task8-legacy:' || id::text WHERE logical_key IS NULL`,
    `UPDATE booking_request_email_deliveries SET status = 'processing', next_attempt_at = COALESCE(next_attempt_at, claimed_at) WHERE status = 'pending' AND claimed_at IS NOT NULL`,
    `UPDATE booking_request_email_deliveries SET next_attempt_at = COALESCE(next_attempt_at, last_attempt_at, created_at, now()) WHERE status = 'pending' AND claimed_at IS NULL`,
    `ALTER TABLE booking_request_email_deliveries ALTER COLUMN logical_key SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_request_email_deliveries_logical_key_unique ON booking_request_email_deliveries (property_id, booking_request_id, logical_key)`,
    `CREATE INDEX IF NOT EXISTS booking_request_email_deliveries_recovery_idx ON booking_request_email_deliveries (status, next_attempt_at, claimed_at) WHERE status IN ('pending', 'processing')`,
    `CREATE INDEX IF NOT EXISTS booking_request_email_deliveries_property_request_idx ON booking_request_email_deliveries (property_id, booking_request_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS bookings_property_external_channel_unique ON bookings (property_id, external_confirmation, channel_code) WHERE external_confirmation IS NOT NULL AND channel_code IS NOT NULL`,
    // Stay extras / packages
    `CREATE TABLE IF NOT EXISTS services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      code varchar(40) NOT NULL,
      name varchar(255) NOT NULL,
      description text,
      charge_type charge_type NOT NULL DEFAULT 'incidental',
      price numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      tax_code varchar(20),
      posting_rule service_posting_rule NOT NULL DEFAULT 'once',
      sell_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS services_property_idx ON services (property_id)`,
    `CREATE INDEX IF NOT EXISTS services_property_code_idx ON services (property_id, code)`,
    `CREATE TABLE IF NOT EXISTS rate_plan_components (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
      service_id uuid NOT NULL REFERENCES services(id),
      quantity integer NOT NULL DEFAULT 1,
      amount_override numeric(12,2),
      included_in_rate boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS rate_plan_components_property_idx ON rate_plan_components (property_id)`,
    `CREATE INDEX IF NOT EXISTS rate_plan_components_rate_plan_idx ON rate_plan_components (property_id, rate_plan_id)`,
    `CREATE TABLE IF NOT EXISTS reservation_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid NOT NULL REFERENCES reservations(id),
      service_id uuid NOT NULL REFERENCES services(id),
      quantity integer NOT NULL DEFAULT 1,
      unit_price numeric(12,2) NOT NULL,
      currency_code varchar(3) NOT NULL,
      start_date date,
      end_date date,
      status reservation_service_status NOT NULL DEFAULT 'confirmed',
      source_channel varchar(40) NOT NULL DEFAULT 'front_desk',
      posting_rule service_posting_rule NOT NULL,
      charge_type charge_type NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS reservation_services_property_idx ON reservation_services (property_id)`,
    `CREATE INDEX IF NOT EXISTS reservation_services_reservation_idx ON reservation_services (property_id, reservation_id)`,
    // Cancellation policies (money outcomes for cancel / no-show)
    `CREATE TABLE IF NOT EXISTS cancellation_policies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      name varchar(100) NOT NULL,
      code varchar(20) NOT NULL,
      description text,
      free_cancel_hours_before_arrival integer NOT NULL DEFAULT 24,
      penalty_type cancellation_penalty_type NOT NULL DEFAULT 'first_night',
      penalty_percentage numeric(5,2),
      deposit_handling cancellation_deposit_handling NOT NULL DEFAULT 'refund_if_refundable',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS cancellation_policies_property_idx ON cancellation_policies (property_id)`,
    `CREATE INDEX IF NOT EXISTS cancellation_policies_property_code_idx ON cancellation_policies (property_id, code)`,
    `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rate_plans_cancellation_policy_id_fkey'
      ) THEN
        ALTER TABLE rate_plans
          ADD CONSTRAINT rate_plans_cancellation_policy_id_fkey
          FOREIGN KEY (cancellation_policy_id) REFERENCES cancellation_policies(id);
      END IF;
    END $$`,
  ];

  for (const t of tables) {
    await db.execute(sql.raw(t));
  }

  await db
    .insert(schema.integrationCatalogEntries)
    .values(INTEGRATION_REGISTRY_SEED)
    .onConflictDoUpdate({
      target: schema.integrationCatalogEntries.slug,
      set: {
        category: sql`excluded.category`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        docsPath: sql`excluded.docs_path`,
        adapterKey: sql`excluded.adapter_key`,
        description: sql`excluded.description`,
        updatedAt: sql`now()`,
      },
    });

  // Organizations (hotel groups) — portfolio reporting
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      code varchar(20) NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS loyalty_programs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      name varchar(120) NOT NULL,
      points_per_night integer NOT NULL DEFAULT 100,
      delay_days integer NOT NULL DEFAULT 3,
      earn_enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      program_id uuid NOT NULL REFERENCES loyalty_programs(id),
      guest_id uuid NOT NULL REFERENCES guests(id),
      available_points integer NOT NULL DEFAULT 0,
      pending_points integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
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
    )`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS loyalty_transactions_org_account_idx
      ON loyalty_transactions (organization_id, account_id, created_at DESC)`));

  await db.execute(sql.raw(`
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_notification_severity') THEN
      CREATE TYPE staff_notification_severity AS ENUM ('info','warning','critical');
    END IF; END $$`));

  // Fiscal documents — external tax document references (invoice.* events)
  await db.execute(sql.raw(`
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_document_status') THEN
      CREATE TYPE fiscal_document_status AS ENUM ('requested','issued','voided');
    END IF; END $$`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS fiscal_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      folio_id uuid NOT NULL REFERENCES folios(id),
      document_type varchar(50) NOT NULL,
      status fiscal_document_status NOT NULL DEFAULT 'requested',
      document_number varchar(100),
      document_url text,
      issued_at timestamptz,
      voided_at timestamptz,
      void_reason text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS fiscal_documents_property_folio_idx
      ON fiscal_documents (property_id, folio_id)`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS staff_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      user_id varchar(255),
      type varchar(50) NOT NULL,
      title varchar(255) NOT NULL,
      message text NOT NULL,
      severity staff_notification_severity NOT NULL DEFAULT 'info',
      source_event varchar(100),
      source_entity_type varchar(50),
      source_entity_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS staff_notifications_property_created_idx
      ON staff_notifications (property_id, created_at DESC)`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS staff_notification_reads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id uuid NOT NULL REFERENCES staff_notifications(id),
      user_id varchar(255) NOT NULL,
      read_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_notification_reads_unique
      ON staff_notification_reads (notification_id, user_id)`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS door_lock_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      reservation_id uuid NOT NULL REFERENCES reservations(id),
      room_id uuid REFERENCES rooms(id),
      provider varchar(50) NOT NULL,
      credential_id varchar(100) NOT NULL,
      access_code varchar(20),
      status door_lock_credential_status NOT NULL DEFAULT 'active',
      issued_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS door_lock_credentials_property_reservation_unique
      ON door_lock_credentials (property_id, reservation_id)`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS door_lock_credentials_property_status_idx
      ON door_lock_credentials (property_id, status)`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS migration_source_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      source_pms varchar(50) NOT NULL,
      ciphertext text NOT NULL,
      encryption_key_id varchar(50) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      rotated_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS migration_source_credentials_property_source_unique
      ON migration_source_credentials (property_id, source_pms)`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS migration_source_credentials_property_idx
      ON migration_source_credentials (property_id)`));

  // iCal calendar bridge (.ics import/export) — availability subtracts ical_blocks
  await db.execute(sql.raw(`
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ical_feed_direction') THEN
      CREATE TYPE ical_feed_direction AS ENUM ('import','export');
    END IF; END $$`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ical_feeds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      room_type_id uuid NOT NULL REFERENCES room_types(id),
      direction ical_feed_direction NOT NULL,
      name varchar(120) NOT NULL,
      source_url text,
      token_hash varchar(64),
      is_active boolean NOT NULL DEFAULT true,
      last_sync_at timestamptz,
      last_sync_status varchar(20),
      last_sync_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS ical_feeds_property_room_direction_idx
      ON ical_feeds (property_id, room_type_id, direction)`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ical_blocks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id uuid NOT NULL REFERENCES properties(id),
      feed_id uuid NOT NULL REFERENCES ical_feeds(id),
      room_type_id uuid NOT NULL REFERENCES room_types(id),
      external_uid varchar(255) NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      summary varchar(255),
      source_checksum varchar(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS ical_blocks_property_room_dates_idx
      ON ical_blocks (property_id, room_type_id, start_date, end_date)`));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS ical_blocks_feed_dates_idx
      ON ical_blocks (feed_id, start_date, end_date)`));

  // Idempotent column additions for pre-existing databases
  const alters = [
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id)`,
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_display_name varchar(200)`,
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_logo_media_id uuid`,
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_primary_color varchar(9)`,
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_accent_color varchar(9)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE tax_rules ADD COLUMN IF NOT EXISTS split_percentage numeric(5,2)`,
    // House accounts reuse charges/payments (KB 13): folio_id becomes nullable,
    // add house_account_id. A row belongs to EITHER a folio OR a house account.
    `ALTER TABLE charges ALTER COLUMN folio_id DROP NOT NULL`,
    `ALTER TABLE charges ADD COLUMN IF NOT EXISTS house_account_id uuid`,
    // Split-component tax charges link to their parent charge (self-FK).
    `ALTER TABLE charges ADD COLUMN IF NOT EXISTS parent_charge_id uuid`,
    `ALTER TABLE charges ADD COLUMN IF NOT EXISTS source_key varchar(255)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS charges_property_folio_source_key_unique ON charges (property_id, folio_id, source_key)`,
    `ALTER TABLE payments ALTER COLUMN folio_id DROP NOT NULL`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS house_account_id uuid`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_request_id uuid REFERENCES booking_requests(id)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar(255)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS payments_property_idempotency_key_unique ON payments (property_id, idempotency_key)`,
    `ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS booking_mode varchar(10)`,
    `ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS payment_method_collection varchar(10)`,
    `ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS form_questions jsonb`,
    `ALTER TABLE booking_engine_config ALTER COLUMN booking_mode SET DEFAULT 'instant'`,
    `ALTER TABLE booking_engine_config ALTER COLUMN payment_method_collection SET DEFAULT 'disabled'`,
    `ALTER TABLE booking_engine_config ALTER COLUMN form_questions SET DEFAULT '[]'::jsonb`,
    `UPDATE booking_engine_config SET booking_mode = COALESCE(booking_mode, 'instant'), payment_method_collection = COALESCE(payment_method_collection, 'disabled'), form_questions = COALESCE(form_questions, '[]'::jsonb)`,
    `ALTER TABLE booking_engine_config ALTER COLUMN booking_mode SET NOT NULL`,
    `ALTER TABLE booking_engine_config ALTER COLUMN payment_method_collection SET NOT NULL`,
    `ALTER TABLE booking_engine_config ALTER COLUMN form_questions SET NOT NULL`,
    `ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS submission_idempotency_key varchar(200)`,
    `ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS submission_fingerprint varchar(64)`,
    `ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS setup_intent_id varchar(255)`,
    `UPDATE booking_requests SET submission_idempotency_key = COALESCE(submission_idempotency_key, 'legacy-' || id::text), submission_fingerprint = COALESCE(submission_fingerprint, md5(id::text) || md5('booking-request:' || id::text))`,
    `ALTER TABLE booking_requests ALTER COLUMN submission_idempotency_key SET NOT NULL`,
    `ALTER TABLE booking_requests ALTER COLUMN submission_fingerprint SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_property_submission_key_unique ON booking_requests (property_id, submission_idempotency_key)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_setup_intent_unique ON booking_requests (setup_intent_id)`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'completed'`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS idempotency_key varchar(255)`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS operation_fingerprint varchar(64)`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS provider_transaction_id varchar(255)`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS provider_status varchar(40)`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS movement_id uuid`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS last_error text`,
    `ALTER TABLE booking_request_payment_resolutions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
    `ALTER TABLE booking_request_payment_resolutions ALTER COLUMN resolved_at DROP NOT NULL`,
    `ALTER TABLE booking_request_payment_resolutions ALTER COLUMN resolved_at DROP DEFAULT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_request_payment_resolutions_property_idempotency_unique ON booking_request_payment_resolutions (property_id, idempotency_key)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_requests_property_id_unique ON booking_requests (property_id, id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_request_installments_property_request_id_unique ON booking_request_installments (property_id, booking_request_id, id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS payments_property_request_id_unique ON payments (property_id, booking_request_id, id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS payments_property_request_parent_id_unique ON payments (property_id, booking_request_id, original_payment_id, id)`,
    `DROP INDEX IF EXISTS audit_logs_booking_request_allocation_repair_unique`,
    `DROP INDEX IF EXISTS audit_logs_booking_request_installment_repair_unique`,
    `DO $$ BEGIN
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
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_request_fkey') THEN
        ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_request_fkey
          FOREIGN KEY (property_id, booking_request_id) REFERENCES booking_requests(property_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_payment_fkey') THEN
        ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_payment_fkey
          FOREIGN KEY (property_id, booking_request_id, payment_id) REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_allocations_installment_fkey') THEN
        ALTER TABLE booking_request_payment_allocations ADD CONSTRAINT booking_request_payment_allocations_installment_fkey
          FOREIGN KEY (property_id, booking_request_id, installment_id) REFERENCES booking_request_installments(property_id, booking_request_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_request_fkey') THEN
        ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_request_fkey
          FOREIGN KEY (property_id, booking_request_id) REFERENCES booking_requests(property_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_payment_fkey') THEN
        ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_payment_fkey
          FOREIGN KEY (property_id, booking_request_id, payment_id) REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_movement_fkey') THEN
        ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_movement_fkey
          FOREIGN KEY (property_id, booking_request_id, movement_id) REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_movement_id_fkey') THEN
        ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_movement_id_fkey
          FOREIGN KEY (movement_id) REFERENCES payments(id) NOT VALID;
      END IF;
    END $$`,
    `ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_amount_kind_check`,
    `ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_milestone_date_check`,
    `ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_allocated_nonnegative_check`,
    `ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_positive_check`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_positive_check`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_status_check`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_retained_reason_check`,
    `ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_parent_positive_check`,
    `ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_request_fkey`,
    `ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_payment_fkey`,
    `ALTER TABLE booking_request_payment_allocations VALIDATE CONSTRAINT booking_request_payment_allocations_installment_fkey`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_request_fkey`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_payment_fkey`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_movement_fkey`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_movement_id_fkey`,
    `UPDATE booking_request_payment_resolutions r
      SET movement_id = p.id,
          provider_transaction_id = CASE WHEN r.type = 'refund' THEN COALESCE(r.provider_transaction_id, p.gateway_transaction_id) ELSE r.provider_transaction_id END,
          provider_status = CASE WHEN r.type = 'refund' THEN COALESCE(r.provider_status, 'succeeded') ELSE r.provider_status END
      FROM payments p
      WHERE r.status = 'completed'
        AND r.type IN ('refund', 'external_return')
        AND r.movement_id IS NULL
        AND p.property_id = r.property_id
        AND p.booking_request_id = r.booking_request_id
        AND p.original_payment_id = r.payment_id
        AND r.reason LIKE '%' || p.id::text || '%'`,
    `UPDATE booking_request_payment_resolutions r
      SET provider_transaction_id = COALESCE(r.provider_transaction_id, p.gateway_transaction_id),
          provider_status = COALESCE(r.provider_status, 'succeeded')
      FROM payments p
      WHERE r.type = 'refund' AND r.status = 'completed' AND r.movement_id = p.id`,
    `UPDATE booking_request_payment_resolutions
      SET resolved_at = COALESCE(resolved_at, updated_at, created_at)
      WHERE status IN ('completed', 'failed')`,
    `DO $booking_request_resolution_provenance$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM booking_request_payment_resolutions
          WHERE status = 'completed' AND type IN ('refund', 'external_return') AND movement_id IS NULL
        ) THEN
          RAISE EXCEPTION 'Completed Booking Request refund/return lacks canonical movement provenance';
        END IF;
      END
      $booking_request_resolution_provenance$`,
    `CREATE UNIQUE INDEX IF NOT EXISTS br_payment_resolutions_property_provider_tx_unique
      ON booking_request_payment_resolutions (property_id, provider_transaction_id)`,
    `-- booking_request_net_allocation_repair: locked, causally exact, and audited from RETURNING
      DO $booking_request_financial_repair_lock$
      DECLARE
        repaired_count bigint;
      BEGIN
        PERFORM parent.id
        FROM payments parent
        WHERE parent.booking_request_id IS NOT NULL AND parent.original_payment_id IS NULL
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
        SELECT parent.property_id, parent.booking_request_id, parent.id AS payment_id,
          GREATEST(parent.amount + COALESCE(SUM(child.amount) FILTER (WHERE child.status = 'captured'), 0), 0) AS net_amount
        FROM payments parent
        LEFT JOIN payments child
          ON child.property_id = parent.property_id
          AND child.booking_request_id = parent.booking_request_id
          AND child.original_payment_id = parent.id
        WHERE parent.booking_request_id IS NOT NULL AND parent.original_payment_id IS NULL
        GROUP BY parent.property_id, parent.booking_request_id, parent.id, parent.amount
      ), ranked AS (
        SELECT allocation.id, allocation.property_id, allocation.booking_request_id,
          allocation.payment_id, allocation.installment_id, allocation.amount AS old_amount,
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
          GREATEST(LEAST(ranked.old_amount, ranked.net_amount - ranked.used_before), 0) AS new_amount
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
        RETURNING entity_id
      )
      SELECT COUNT(*) INTO repaired_count FROM audit_evidence;

      WITH installment_totals AS (
        SELECT installment.id, installment.property_id, installment.booking_request_id,
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
        RETURNING entity_id
      )
      SELECT COUNT(*) INTO repaired_count FROM audit_evidence;
      END
      $booking_request_financial_repair_lock$`,
    `ALTER TABLE booking_request_payment_resolutions
      DROP CONSTRAINT IF EXISTS booking_request_payment_resolutions_retained_reason_check,
      DROP CONSTRAINT IF EXISTS booking_request_payment_resolutions_lifecycle_check`,
    `DO $$ BEGIN
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
            OR (status = 'failed' AND type = 'refund'
              AND idempotency_key IS NOT NULL AND operation_fingerprint IS NOT NULL
              AND resolved_at IS NOT NULL AND movement_id IS NULL)
            OR (status = 'completed' AND resolved_at IS NOT NULL AND (
              (type IN ('refund', 'external_return') AND movement_id IS NOT NULL)
              OR (type = 'retained' AND movement_id IS NULL)
            ))
          ) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_child_shape_check') THEN
        ALTER TABLE payments ADD CONSTRAINT payments_booking_request_child_shape_check
          CHECK (booking_request_id IS NULL OR original_payment_id IS NULL OR (amount < 0 AND status = 'captured')) NOT VALID;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_consequences_request_fkey') THEN
        ALTER TABLE booking_request_consequences ADD CONSTRAINT booking_request_consequences_request_fkey
          FOREIGN KEY (property_id, booking_request_id) REFERENCES booking_requests(property_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_installments_request_fkey') THEN
        ALTER TABLE booking_request_installments ADD CONSTRAINT booking_request_installments_request_fkey
          FOREIGN KEY (property_id, booking_request_id) REFERENCES booking_requests(property_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_email_deliveries_request_fkey') THEN
        ALTER TABLE booking_request_email_deliveries ADD CONSTRAINT booking_request_email_deliveries_request_fkey
          FOREIGN KEY (property_id, booking_request_id) REFERENCES booking_requests(property_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_fkey') THEN
        ALTER TABLE payments ADD CONSTRAINT payments_booking_request_fkey
          FOREIGN KEY (property_id, booking_request_id) REFERENCES booking_requests(property_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_request_parent_fkey') THEN
        ALTER TABLE payments ADD CONSTRAINT payments_booking_request_parent_fkey
          FOREIGN KEY (property_id, booking_request_id, original_payment_id) REFERENCES payments(property_id, booking_request_id, id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_request_payment_resolutions_parent_movement_fkey') THEN
        ALTER TABLE booking_request_payment_resolutions ADD CONSTRAINT booking_request_payment_resolutions_parent_movement_fkey
          FOREIGN KEY (property_id, booking_request_id, payment_id, movement_id) REFERENCES payments(property_id, booking_request_id, original_payment_id, id) NOT VALID;
      END IF;
    END $$`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_retained_reason_check`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_lifecycle_check`,
    `ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_child_shape_check`,
    `ALTER TABLE booking_request_installments VALIDATE CONSTRAINT booking_request_installments_request_fkey`,
    `ALTER TABLE booking_request_consequences VALIDATE CONSTRAINT booking_request_consequences_request_fkey`,
    `ALTER TABLE booking_request_email_deliveries VALIDATE CONSTRAINT booking_request_email_deliveries_request_fkey`,
    `ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_fkey`,
    `ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_request_parent_fkey`,
    `ALTER TABLE booking_request_payment_resolutions VALIDATE CONSTRAINT booking_request_payment_resolutions_parent_movement_fkey`,
    `DO $booking_request_accepted_snapshot_precondition$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM booking_requests br
        LEFT JOIN reservations r
          ON r.id = br.accepted_reservation_id
          AND r.property_id = br.property_id
        WHERE br.status = 'accepted'
          AND (
            br.accepted_reservation_id IS NULL
            OR r.id IS NULL
            OR r.accepted_pricing_snapshot IS NULL
            OR (
              jsonb_typeof(r.accepted_pricing_snapshot) = 'object'
              AND (r.accepted_pricing_snapshot ->> 'version') = '1'
              AND (r.accepted_pricing_snapshot ->> 'source') IN ('submitted', 'current', 'custom')
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'currencyCode') = 'string'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'grandTotal') = 'string'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'roomTotal') = 'string'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'taxTotal') = 'string'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'servicesTotal') = 'string'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'servicesTaxTotal') = 'string'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'nights') = 'array'
              AND jsonb_array_length(r.accepted_pricing_snapshot -> 'nights') > 0
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'services') = 'array'
              AND r.accepted_pricing_snapshot ? 'customReason'
              AND jsonb_typeof(r.accepted_pricing_snapshot -> 'customReason') IN ('null', 'string')
              AND (
                (r.accepted_pricing_snapshot ->> 'source') <> 'custom'
                OR jsonb_typeof(r.accepted_pricing_snapshot -> 'customReason') = 'string'
              )
            ) IS NOT TRUE
          )
      ) THEN
        RAISE EXCEPTION 'Cannot apply accepted pricing: an accepted Booking Request lacks a complete immutable reservation snapshot; no lossless backfill exists';
      END IF;
    END
    $booking_request_accepted_snapshot_precondition$`,
    `DO $booking_request_submitted_quote_precondition$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM booking_requests
        WHERE status = 'pending'
          AND (
            jsonb_typeof(submitted_quote_snapshot) = 'object'
            AND jsonb_typeof(submitted_quote_snapshot -> 'currencyCode') = 'string'
            AND submitted_quote_snapshot ->> 'currencyCode' = currency_code
            AND jsonb_typeof(submitted_quote_snapshot -> 'grandTotal') = 'string'
            AND jsonb_typeof(submitted_quote_snapshot -> 'roomTotal') = 'string'
            AND jsonb_typeof(submitted_quote_snapshot -> 'taxTotal') = 'string'
            AND jsonb_typeof(submitted_quote_snapshot -> 'servicesTotal') = 'string'
            AND jsonb_typeof(submitted_quote_snapshot -> 'servicesTaxTotal') = 'string'
            AND jsonb_typeof(submitted_quote_snapshot -> 'lineItems') = 'array'
            AND jsonb_array_length(submitted_quote_snapshot -> 'lineItems') > 0
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(submitted_quote_snapshot -> 'lineItems') = 'array'
                    THEN submitted_quote_snapshot -> 'lineItems'
                  ELSE '[]'::jsonb
                END
              ) AS night
              WHERE (
                jsonb_typeof(night -> 'date') = 'string'
                AND jsonb_typeof(night -> 'rate') = 'string'
                AND jsonb_typeof(night -> 'tax') = 'string'
              ) IS NOT TRUE
            )
            AND jsonb_typeof(submitted_quote_snapshot -> 'services') = 'array'
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(submitted_quote_snapshot -> 'services') = 'array'
                    THEN submitted_quote_snapshot -> 'services'
                  ELSE '[]'::jsonb
                END
              ) AS service
              WHERE (
                jsonb_typeof(service -> 'serviceId') = 'string'
                AND jsonb_typeof(service -> 'code') = 'string'
                AND jsonb_typeof(service -> 'name') = 'string'
                AND jsonb_typeof(service -> 'postingRule') = 'string'
                AND jsonb_typeof(service -> 'chargeType') = 'string'
                AND jsonb_typeof(service -> 'currencyCode') = 'string'
                AND service ->> 'currencyCode' = currency_code
                AND jsonb_typeof(service -> 'unitPrice') = 'string'
                AND jsonb_typeof(service -> 'quantity') = 'number'
                AND jsonb_typeof(service -> 'lineTotal') = 'string'
                AND jsonb_typeof(service -> 'taxTotal') = 'string'
                AND jsonb_typeof(service -> 'lineItems') = 'array'
                AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    CASE
                      WHEN jsonb_typeof(service -> 'lineItems') = 'array'
                        THEN service -> 'lineItems'
                      ELSE '[]'::jsonb
                    END
                  ) AS service_line
                  WHERE (
                    jsonb_typeof(service_line -> 'date') = 'string'
                    AND jsonb_typeof(service_line -> 'amount') = 'string'
                    AND jsonb_typeof(service_line -> 'tax') = 'string'
                  ) IS NOT TRUE
                )
              ) IS NOT TRUE
            )
          ) IS NOT TRUE
      ) THEN
        RAISE EXCEPTION 'Cannot apply accepted pricing: a pending Booking Request has an incompatible submitted quote snapshot and no lossless backfill exists';
      END IF;
    END
    $booking_request_submitted_quote_precondition$`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS logical_event_id uuid`,
    `CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_property_subscription_logical_event_unique ON webhook_deliveries (property_id, subscription_id, logical_event_id)`,
    `DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM payments
        WHERE folio_id IS NULL AND house_account_id IS NULL AND booking_request_id IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot add payments_financial_target_check: legacy payment rows have no folio, house account, or booking request target';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_financial_target_check') THEN
        ALTER TABLE payments ADD CONSTRAINT payments_financial_target_check
          CHECK (folio_id IS NOT NULL OR house_account_id IS NOT NULL OR booking_request_id IS NOT NULL);
      END IF;
    END $$`,
    // Group linkage on reservations (KB 14.3) — added via ALTER to avoid a
    // circular FK at table-create time (group_profiles references nothing of
    // reservations, but reservations is created before group_profiles).
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS group_profile_id uuid`,
    // Commercial profile billing fields + links (KB 14.3 standing accounts)
    `ALTER TABLE group_profiles ADD COLUMN IF NOT EXISTS billing_address text`,
    `ALTER TABLE group_profiles ADD COLUMN IF NOT EXISTS payment_terms_days varchar(10)`,
    `ALTER TABLE ar_ledgers ADD COLUMN IF NOT EXISTS group_profile_id uuid`,
    `ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS group_profile_id uuid`,
    `ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS los_adjustments jsonb`,
    `ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS occupancy_bands jsonb`,
    `ALTER TABLE lost_and_found_items ADD COLUMN IF NOT EXISTS category lost_and_found_category NOT NULL DEFAULT 'general'`,
    // A1: HK observation columns on rooms (CREATE TABLE IF NOT EXISTS leaves legacy DBs without them)
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hk_occupancy hk_occupancy NOT NULL DEFAULT 'unknown'`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hk_observed_persons integer`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hk_observed_at timestamptz`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hk_observed_by uuid`,
    `ALTER TABLE rate_restrictions ADD COLUMN IF NOT EXISTS rate_override numeric(12,2)`,
    `ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS external_id varchar(255)`,
    `ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS external_url text`,
    `ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS provider_place_id varchar(255)`,
    `ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS provider_location_id varchar(255)`,
    `ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS provider_channel_id varchar(255)`,
    `ALTER TABLE guest_reviews ADD COLUMN IF NOT EXISTS last_synced_at timestamptz`,
    `CREATE UNIQUE INDEX IF NOT EXISTS guest_reviews_property_source_external_unique ON guest_reviews (property_id, source, external_id)`,
  ];
  for (const a of alters) {
    await db.execute(sql.raw(a));
  }

  console.log('Schema pushed successfully — all tables created.');
  await client.end();
}

main().catch((err) => {
  console.error('Push failed:', err);
  process.exit(1);
});
