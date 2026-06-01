/**
 * Push schema to database using drizzle-orm's migrate API.
 * Workaround for drizzle-kit CJS/.js extension issue.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

async function main() {
  const client = postgres(DATABASE_URL);
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
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN CREATE TYPE payment_method AS ENUM ('credit_card','debit_card','cash','bank_transfer','city_ledger','vcc','other'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN CREATE TYPE payment_status AS ENUM ('pending','authorized','captured','settled','refunded','partially_refunded','failed','voided'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'housekeeping_task_status') THEN CREATE TYPE housekeeping_task_status AS ENUM ('pending','assigned','in_progress','completed','inspected','skipped'); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'housekeeping_task_type') THEN CREATE TYPE housekeeping_task_type AS ENUM ('checkout','stayover','deep_clean','inspection','turndown','maintenance'); END IF; END $$`,
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
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
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
  ];

  for (const t of tables) {
    await db.execute(sql.raw(t));
  }

  // Idempotent column additions for pre-existing databases
  const alters = [
    `ALTER TABLE tax_rules ADD COLUMN IF NOT EXISTS split_percentage numeric(5,2)`,
    // House accounts reuse charges/payments (KB 13): folio_id becomes nullable,
    // add house_account_id. A row belongs to EITHER a folio OR a house account.
    `ALTER TABLE charges ALTER COLUMN folio_id DROP NOT NULL`,
    `ALTER TABLE charges ADD COLUMN IF NOT EXISTS house_account_id uuid`,
    `ALTER TABLE payments ALTER COLUMN folio_id DROP NOT NULL`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS house_account_id uuid`,
    // Group linkage on reservations (KB 14.3) — added via ALTER to avoid a
    // circular FK at table-create time (group_profiles references nothing of
    // reservations, but reservations is created before group_profiles).
    `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS group_profile_id uuid`,
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
