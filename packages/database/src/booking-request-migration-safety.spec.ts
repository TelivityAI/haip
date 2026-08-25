import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./migrations/0022_booking_request_accepted_pricing.sql', import.meta.url),
  'utf8',
);
const pushSchema = readFileSync(new URL('./push-schema.ts', import.meta.url), 'utf8');
const paymentIntegrityMigration = readFileSync(
  new URL('./migrations/0023_booking_request_payment_integrity.sql', import.meta.url),
  'utf8',
);
const financialRecoveryMigration = readFileSync(
  new URL('./migrations/0024_booking_request_financial_recovery.sql', import.meta.url),
  'utf8',
);
const emailRecoveryMigration = readFileSync(
  new URL('./migrations/0025_booking_request_email_recovery.sql', import.meta.url),
  'utf8',
);
const emailRetryMigration = readFileSync(
  new URL('./migrations/0026_booking_request_email_retry_policy.sql', import.meta.url),
  'utf8',
);
const auditRelationshipMigration = readFileSync(
  new URL('./migrations/0028_booking_request_audit_relationship.sql', import.meta.url),
  'utf8',
);
const amendmentLedgerMigration = readFileSync(
  new URL('./migrations/0030_booking_request_amendment_ledger.sql', import.meta.url),
  'utf8',
);

describe('booking request accepted-pricing migration safety', () => {
  it('fails instead of accepting an already-accepted request without an operational snapshot', () => {
    for (const source of [migration, pushSchema]) {
      expect(source).toContain('booking_request_accepted_snapshot_precondition');
      expect(source).toMatch(/status\s*=\s*'accepted'/);
      expect(source).toMatch(/accepted_pricing_snapshot\s+IS\s+NULL/i);
      expect(source).toMatch(/RAISE EXCEPTION[^;]*accepted Booking Request/i);
    }
  });

  it('fails on a pending submitted quote that cannot be losslessly normalized', () => {
    for (const source of [migration, pushSchema]) {
      expect(source).toContain('booking_request_submitted_quote_precondition');
      expect(source).toMatch(/status\s*=\s*'pending'/);
      expect(source).toContain("jsonb_typeof(submitted_quote_snapshot -> 'lineItems') = 'array'");
      expect(source).toContain("jsonb_typeof(submitted_quote_snapshot -> 'services') = 'array'");
      expect(source).toMatch(/RAISE EXCEPTION[^;]*submitted quote snapshot/i);
    }
  });

  it('adds the nullable namespaced charge source key before its scoped unique index', () => {
    const column = migration.indexOf('ADD COLUMN IF NOT EXISTS source_key');
    const index = migration.indexOf('charges_property_folio_source_key_unique');
    expect(column).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(column);
  });
});

describe('booking request payment integrity migration safety', () => {
  it('persists recoverable resolution claims in both migration paths', () => {
    for (const source of [paymentIntegrityMigration, pushSchema]) {
      expect(source).toContain('booking_request_payment_resolutions_property_idempotency_unique');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS operation_fingerprint');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS movement_id');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS last_error');
      expect(source).toContain('booking_request_payment_resolutions_status_check');
    }
  });

  it('adds positive-money, installment-shape, and aggregate ownership constraints', () => {
    for (const source of [paymentIntegrityMigration, pushSchema]) {
      expect(source).toContain('booking_request_installments_amount_kind_check');
      expect(source).toContain('booking_request_installments_milestone_date_check');
      expect(source).toContain('booking_request_payment_allocations_positive_check');
      expect(source).toContain('booking_request_payment_resolutions_retained_reason_check');
      expect(source).toContain('booking_request_payment_allocations_request_fkey');
      expect(source).toContain('booking_request_payment_resolutions_movement_fkey');
      expect(source).toContain('payments_booking_request_parent_positive_check');
    }
  });

  it('stages complete aggregate ownership, including a movement tied to its exact parent', () => {
    for (const source of [financialRecoveryMigration, pushSchema]) {
      expect(source).toContain('payments_property_request_parent_id_unique');
      expect(source).toContain('booking_request_consequences_request_fkey');
      expect(source).toContain('booking_request_payment_resolutions_parent_movement_fkey');
      expect(source).toMatch(
        /FOREIGN KEY \(property_id, booking_request_id, payment_id, movement_id\)[\s\S]*REFERENCES payments\(property_id, booking_request_id, original_payment_id, id\)/,
      );
    }
  });

  it('repairs net allocations and derived installment state in both migration paths', () => {
    for (const source of [financialRecoveryMigration, pushSchema]) {
      expect(source).toContain('booking_request_net_allocation_repair');
      expect(source).toContain('task7-net-allocation-v1:');
      expect(source).toContain('task7-installment-derived-v1:');
      expect(source).toMatch(/DROP INDEX IF EXISTS audit_logs_booking_request_allocation_repair_unique/i);
      expect(source).toMatch(/DROP INDEX IF EXISTS audit_logs_booking_request_installment_repair_unique/i);
      expect(source).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_booking_request_(allocation|installment)_repair_unique/i);
      expect(source).toContain('booking_request_financial_repair_lock');
      expect(source).toMatch(/ORDER BY parent\.property_id, parent\.booking_request_id, parent\.id[\s\S]*FOR UPDATE/i);
      expect(source).toMatch(/ORDER BY allocation\.property_id, allocation\.booking_request_id,[\s\S]*FOR UPDATE/i);
      expect(source).toMatch(/ORDER BY installment\.property_id, installment\.booking_request_id, installment\.id[\s\S]*FOR UPDATE/i);
      expect(source).toMatch(/RETURNING[\s\S]*old_amount[\s\S]*new_amount/i);
      const repairBlock = source.match(
        /booking_request_net_allocation_repair[\s\S]*?\$booking_request_financial_repair_lock\$/,
      )?.[0];
      expect(repairBlock).not.toContain('ON CONFLICT');
      expect(source).toMatch(/INSERT INTO audit_logs/i);
      expect(source).toMatch(/DELETE FROM booking_request_payment_allocations/i);
      expect(source).toMatch(/UPDATE booking_request_payment_allocations/i);
      expect(source).toMatch(/UPDATE booking_request_installments/i);
      expect(source).toMatch(/allocated_amount\s+IS\s+DISTINCT\s+FROM/i);
      expect(source).toMatch(/status\s+IS\s+DISTINCT\s+FROM/i);
    }
  });
});

describe('booking request email recovery migration safety', () => {
  it('adds stable logical identity, claim recovery, and aggregate ownership in both paths', () => {
    for (const source of [emailRecoveryMigration, pushSchema]) {
      expect(source).toContain('ADD COLUMN IF NOT EXISTS logical_key');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS claimed_at');
      expect(source).toContain('booking_request_email_deliveries_logical_key_unique');
      expect(source).toContain('booking_request_email_deliveries_request_fkey');
    }
  });

  it('backfills existing rows before making logical identity required', () => {
    const addColumn = emailRecoveryMigration.indexOf('ADD COLUMN IF NOT EXISTS logical_key');
    const backfill = emailRecoveryMigration.indexOf('task8-legacy:');
    const notNull = emailRecoveryMigration.indexOf('ALTER COLUMN logical_key SET NOT NULL');
    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(addColumn);
    expect(notNull).toBeGreaterThan(backfill);
  });

  it('adds bounded retry scheduling, provider receipt identity, and a partial recovery index', () => {
    for (const source of [emailRetryMigration, pushSchema]) {
      expect(source).toContain("ADD VALUE IF NOT EXISTS 'processing'");
      expect(source).toContain('ADD COLUMN IF NOT EXISTS next_attempt_at');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS automatic_attempts');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS provider_message_id');
      expect(source).toContain('booking_request_email_deliveries_recovery_idx');
      expect(source).toMatch(/WHERE status IN \('pending', 'processing'\)/i);
    }
  });
});

describe('booking request immutable audit relationship migration safety', () => {
  it('adds the request relationship before its guarded backfill and timeline index', () => {
    const addColumn = auditRelationshipMigration.indexOf(
      'ADD COLUMN IF NOT EXISTS booking_request_id',
    );
    const backfill = auditRelationshipMigration.indexOf('UPDATE audit_logs');
    const index = auditRelationshipMigration.indexOf(
      'audit_logs_booking_request_timeline_idx',
    );

    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(addColumn);
    expect(index).toBeGreaterThan(backfill);
    expect(auditRelationshipMigration).toContain(
      "~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
    );
  });

  it('keeps the direct relationship and bounded timeline index in push schema', () => {
    expect(pushSchema).toContain('booking_request_id uuid');
    expect(pushSchema).toContain('ADD COLUMN IF NOT EXISTS booking_request_id uuid');
    expect(pushSchema).toContain('audit_logs_booking_request_timeline_idx');
    expect(pushSchema).toMatch(
      /\(property_id, booking_request_id, occurred_at DESC, id DESC\)/,
    );
    expect(pushSchema).toMatch(
      /INSERT INTO audit_logs \(\s*property_id, booking_request_id,[\s\S]*?SELECT mutation\.property_id,\s*mutation\.booking_request_id,/,
    );
    expect(pushSchema).toMatch(
      /INSERT INTO audit_logs \(\s*property_id, booking_request_id,[\s\S]*?SELECT repaired\.property_id,\s*repaired\.booking_request_id,/,
    );
  });

  it('casts legacy request metadata only after each candidate passes UUID validation', () => {
    for (const source of [auditRelationshipMigration, pushSchema]) {
      for (const candidate of [
        "new_value->>'bookingRequestId'",
        "new_value->>'requestId'",
        "previous_value->>'bookingRequestId'",
        "previous_value->>'requestId'",
      ]) {
        expect(source).toContain(`CASE WHEN ${candidate} ~*`);
        expect(source).toContain(`THEN (${candidate})::uuid END`);
      }
      expect(source).not.toMatch(/NULLIF\([^)]*->>'(?:bookingRequestId|requestId)'[^)]*\)::uuid/);
    }
  });

  it('propagates tombstones only from one unambiguous property/entity relationship', () => {
    for (const source of [auditRelationshipMigration, pushSchema]) {
      expect(source).toContain('unique_request_relationships');
      expect(source).toMatch(/GROUP BY property_id, entity_type, entity_id/i);
      expect(source).toMatch(/HAVING count\(DISTINCT booking_request_id\) = 1/i);
      expect(source).toMatch(/target\.booking_request_id IS NULL/i);
      expect(source).toMatch(/target\.property_id = relationship\.property_id/i);
      expect(source).toMatch(/target\.entity_type = relationship\.entity_type/i);
      expect(source).toMatch(/target\.entity_id = relationship\.entity_id/i);
    }
  });
});

describe('booking request amendment ledger migration safety', () => {
  it('adds immutable correction provenance in both migration paths', () => {
    for (const source of [amendmentLedgerMigration, pushSchema]) {
      expect(source).toContain('ADD COLUMN IF NOT EXISTS adjusts_charge_id');
      expect(source).toContain('charges_adjusts_charge_fkey');
      expect(source).toMatch(/FOREIGN KEY \(adjusts_charge_id\) REFERENCES charges\(id\)/i);
    }
  });

  it('migrates accepted once identities to include their immutable service date', () => {
    for (const source of [amendmentLedgerMigration, pushSchema]) {
      expect(source).toContain('accepted-pricing:reservation-service:');
      expect(source).toContain("source_key LIKE 'accepted-pricing:reservation-service:%:once'");
      expect(source).toMatch(/source_key\s*\|\|\s*':'\s*\|\|\s*to_char\([^)]*service_date AT TIME ZONE 'UTC'/i);
    }
  });

  it('does not rewrite monetary, reversal, or lock state', () => {
    for (const source of [amendmentLedgerMigration]) {
      expect(source).not.toMatch(/SET\s+(amount|is_reversal|is_locked|service_date)\s*=/i);
    }
  });
});
