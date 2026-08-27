/**
 * Schema de-pollution guardrail for the `@telivityhaip/booking-requests`
 * package split (see its README "Package boundary" section).
 *
 * Core intentionally KEEPS a handful of thin, request-mode-adjacent columns
 * and indexes in `push-schema.ts` / Drizzle because non-request-mode code
 * paths read them directly (the payments financial-target invariant,
 * amendment/charge reversal provenance):
 *   - `payments.booking_request_id` / `payments.idempotency_key`
 *   - `reservations.accepted_pricing_snapshot`
 *   - `charges.adjusts_charge_id` / `charges.source_key` (+ their unique index)
 *
 * Core intentionally DOES NOT keep the booking-requests-package-only DDL:
 *   - `booking_engine_config.booking_mode` / `payment_method_collection` /
 *     `form_questions` — request-mode-only columns. Core's
 *     `BookingEngineConfigService` reads/writes them through the optional
 *     `BOOKING_REQUEST_CONFIG_FIELDS_PORT` (see
 *     `@telivityhaip/booking-requests`'s `booking-request-config-fields.port.ts`
 *     + its `database/schema/booking-engine.ts` extension table), defaulting
 *     to instant/disabled/[] when the package isn't wired in.
 *   - `audit_logs.booking_request_id` (+ its timeline index)
 *   - the request-shape unique indexes/checks on `payments`
 * Those are declared and migrated by `packages/booking-requests` instead.
 *
 * This spec is a static guardrail, not a live-database test: it fails loudly
 * if either the Drizzle schema or the `push-schema.ts` DDL strings drift from
 * this contract, without requiring Postgres.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { bookingEngineConfig } from './schema/booking-engine.js';
import { auditLogs } from './schema/audit.js';
import { charges, payments } from './schema/folio.js';
import { reservations } from './schema/reservation.js';

const pushSchemaSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'push-schema.ts'),
  'utf-8',
);

describe('push-schema / drizzle kept vs. removed request-mode fields', () => {
  it('does not declare booking-requests-package-only booking_engine_config DDL in core', () => {
    expect((bookingEngineConfig as unknown as Record<string, unknown>)['bookingMode']).toBeUndefined();
    expect(
      (bookingEngineConfig as unknown as Record<string, unknown>)['paymentMethodCollection'],
    ).toBeUndefined();
    expect((bookingEngineConfig as unknown as Record<string, unknown>)['formQuestions']).toBeUndefined();

    expect(pushSchemaSource).not.toContain(
      'ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS booking_mode',
    );
    expect(pushSchemaSource).not.toContain(
      'ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS payment_method_collection',
    );
    expect(pushSchemaSource).not.toContain(
      'ALTER TABLE booking_engine_config ADD COLUMN IF NOT EXISTS form_questions',
    );
  });

  it('keeps payments.booking_request_id / idempotency_key in drizzle and push-schema', () => {
    expect(payments.bookingRequestId).toBeDefined();
    expect(payments.idempotencyKey).toBeDefined();

    expect(pushSchemaSource).toContain(
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_request_id uuid',
    );
    expect(pushSchemaSource).toContain(
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar(255)',
    );
  });

  it('keeps reservations.accepted_pricing_snapshot in drizzle and push-schema', () => {
    expect(reservations.acceptedPricingSnapshot).toBeDefined();
    expect(pushSchemaSource).toContain(
      'ALTER TABLE reservations ADD COLUMN IF NOT EXISTS accepted_pricing_snapshot jsonb',
    );
  });

  it('keeps charges adjustment/source-key provenance in drizzle and push-schema', () => {
    expect(charges.adjustsChargeId).toBeDefined();
    expect(charges.sourceKey).toBeDefined();

    const chargeIndexNames = getTableConfig(charges).indexes.map((index) => index.config.name);
    expect(chargeIndexNames).toContain('charges_property_folio_source_key_unique');

    expect(pushSchemaSource).toContain(
      'ALTER TABLE charges ADD COLUMN IF NOT EXISTS adjusts_charge_id uuid',
    );
    expect(pushSchemaSource).toContain(
      'ALTER TABLE charges ADD COLUMN IF NOT EXISTS source_key varchar(255)',
    );
    expect(pushSchemaSource).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS charges_property_folio_source_key_unique ON charges (property_id, folio_id, source_key)',
    );
  });

  it('does not declare booking-requests-package-only audit_logs DDL in core', () => {
    expect((auditLogs as unknown as Record<string, unknown>)['bookingRequestId']).toBeUndefined();

    const indexNames = getTableConfig(auditLogs).indexes.map((index) => index.config.name);
    expect(indexNames).not.toContain('audit_logs_booking_request_timeline_idx');

    expect(pushSchemaSource).not.toContain(
      'ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS booking_request_id uuid',
    );
  });

  it('does not declare booking-requests-package-only payments request-shape DDL in core', () => {
    const paymentIndexNames = getTableConfig(payments).indexes.map((index) => index.config.name);
    expect(paymentIndexNames).not.toContain('payments_property_request_id_unique');
    expect(paymentIndexNames).not.toContain('payments_property_request_parent_id_unique');

    const paymentCheckNames = getTableConfig(payments).checks.map((check) => check.name);
    expect(paymentCheckNames).not.toContain('payments_booking_request_parent_positive_check');
    expect(paymentCheckNames).not.toContain('payments_booking_request_child_shape_check');
  });
});
