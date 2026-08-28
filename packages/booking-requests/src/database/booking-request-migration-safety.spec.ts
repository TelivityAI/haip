/**
 * Ported from PR #347's packages/database/src/booking-request-migration-safety.spec.ts
 * (https://github.com/TelivityAI/haip/pull/347), adapted for the standalone
 * @telivityhaip/booking-requests package.
 *
 * #347 cross-checked every migration against `packages/database/src/push-schema.ts`,
 * because at that point push-schema carried a duplicate, hand-maintained copy of
 * this same DDL for fresh installs. That duplication was removed when this
 * feature moved into its own package (push-schema now only keeps the handful of
 * core-owned columns documented in packages/database/src/push-schema.ts), so
 * these assertions are scoped to the package's own migration files only.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bookingRequestMigration = readFileSync(
  new URL('./migrations/0022_booking_requests.sql', import.meta.url),
  'utf8',
);
const pricingMigration = readFileSync(
  new URL('./migrations/0023_booking_request_accepted_pricing.sql', import.meta.url),
  'utf8',
);
const paymentIntegrityMigration = readFileSync(
  new URL('./migrations/0024_booking_request_payment_integrity.sql', import.meta.url),
  'utf8',
);
const financialRecoveryMigration = readFileSync(
  new URL('./migrations/0025_booking_request_financial_recovery.sql', import.meta.url),
  'utf8',
);
const emailRecoveryMigration = readFileSync(
  new URL('./migrations/0026_booking_request_email_recovery.sql', import.meta.url),
  'utf8',
);
const emailRetryMigration = readFileSync(
  new URL('./migrations/0027_booking_request_email_retry_policy.sql', import.meta.url),
  'utf8',
);
const auditRelationshipMigration = readFileSync(
  new URL('./migrations/0029_booking_request_audit_relationship.sql', import.meta.url),
  'utf8',
);
const amendmentLedgerMigration = readFileSync(
  new URL('./migrations/0031_booking_request_amendment_ledger.sql', import.meta.url),
  'utf8',
);
const remediationMigrationUrl = new URL(
  './migrations/0032_booking_request_remediation.sql',
  import.meta.url,
);

describe('booking request migration sequence', () => {
  it('keeps one migration per numeric sequence', () => {
    const migrationNames = readdirSync(new URL('./migrations', import.meta.url))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name));
    const sequences = migrationNames.map((name) => name.slice(0, 4));

    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('allows request-owned payments before a folio exists', () => {
    const nullableFolio = bookingRequestMigration.indexOf(
      'ALTER TABLE payments ALTER COLUMN folio_id DROP NOT NULL',
    );
    const requestTarget = bookingRequestMigration.indexOf(
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_request_id uuid',
    );

    expect(nullableFolio).toBeGreaterThanOrEqual(0);
    expect(nullableFolio).toBeLessThan(requestTarget);
  });
});

describe('booking request accepted-pricing migration safety', () => {
  it('fails instead of accepting an already-accepted request without an operational snapshot', () => {
    expect(pricingMigration).toContain('booking_request_accepted_snapshot_precondition');
    expect(pricingMigration).toMatch(/status\s*=\s*'accepted'/);
    expect(pricingMigration).toMatch(/accepted_pricing_snapshot\s+IS\s+NULL/i);
    expect(pricingMigration).toMatch(/RAISE EXCEPTION[^;]*accepted Booking Request/i);
  });

  it('fails on a pending submitted quote that cannot be losslessly normalized', () => {
    expect(pricingMigration).toContain('booking_request_submitted_quote_precondition');
    expect(pricingMigration).toMatch(/status\s*=\s*'pending'/);
    expect(pricingMigration).toContain("jsonb_typeof(submitted_quote_snapshot -> 'lineItems') = 'array'");
    expect(pricingMigration).toContain("jsonb_typeof(submitted_quote_snapshot -> 'services') = 'array'");
    expect(pricingMigration).toMatch(/RAISE EXCEPTION[^;]*submitted quote snapshot/i);
  });

  it('adds the nullable namespaced charge source key before its scoped unique index', () => {
    const column = pricingMigration.indexOf('ADD COLUMN IF NOT EXISTS source_key');
    const index = pricingMigration.indexOf('charges_property_folio_source_key_unique');
    expect(column).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(column);
  });
});

describe('booking request payment integrity migration safety', () => {
  it('persists recoverable resolution claims', () => {
    expect(paymentIntegrityMigration).toContain('booking_request_payment_resolutions_property_idempotency_unique');
    expect(paymentIntegrityMigration).toContain('ADD COLUMN IF NOT EXISTS operation_fingerprint');
    expect(paymentIntegrityMigration).toContain('ADD COLUMN IF NOT EXISTS movement_id');
    expect(paymentIntegrityMigration).toContain('ADD COLUMN IF NOT EXISTS last_error');
    expect(paymentIntegrityMigration).toContain('booking_request_payment_resolutions_status_check');
  });

  it('adds positive-money, installment-shape, and aggregate ownership constraints', () => {
    expect(paymentIntegrityMigration).toContain('booking_request_installments_amount_kind_check');
    expect(paymentIntegrityMigration).toContain('booking_request_installments_milestone_date_check');
    expect(paymentIntegrityMigration).toContain('booking_request_payment_allocations_positive_check');
    expect(paymentIntegrityMigration).toContain('booking_request_payment_resolutions_retained_reason_check');
    expect(paymentIntegrityMigration).toContain('booking_request_payment_allocations_request_fkey');
    expect(paymentIntegrityMigration).toContain('booking_request_payment_resolutions_movement_fkey');
    expect(paymentIntegrityMigration).toContain('payments_booking_request_parent_positive_check');
  });

  it('stages complete aggregate ownership, including a movement tied to its exact parent', () => {
    expect(financialRecoveryMigration).toContain('payments_property_request_parent_id_unique');
    expect(financialRecoveryMigration).toContain('booking_request_consequences_request_fkey');
    expect(financialRecoveryMigration).toContain('booking_request_payment_resolutions_parent_movement_fkey');
    expect(financialRecoveryMigration).toMatch(
      /FOREIGN KEY \(property_id, booking_request_id, payment_id, movement_id\)[\s\S]*REFERENCES payments\(property_id, booking_request_id, original_payment_id, id\)/,
    );
  });

  it('repairs net allocations and derived installment state atomically and idempotently', () => {
    expect(financialRecoveryMigration).toContain('booking_request_net_allocation_repair');
    expect(financialRecoveryMigration).toContain('task7-net-allocation-v1:');
    expect(financialRecoveryMigration).toContain('task7-installment-derived-v1:');
    expect(financialRecoveryMigration).toMatch(/DROP INDEX IF EXISTS audit_logs_booking_request_allocation_repair_unique/i);
    expect(financialRecoveryMigration).toMatch(/DROP INDEX IF EXISTS audit_logs_booking_request_installment_repair_unique/i);
    expect(financialRecoveryMigration).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_booking_request_(allocation|installment)_repair_unique/i);
    expect(financialRecoveryMigration).toContain('booking_request_financial_repair_lock');
    expect(financialRecoveryMigration).toMatch(/ORDER BY parent\.property_id, parent\.booking_request_id, parent\.id[\s\S]*FOR UPDATE/i);
    expect(financialRecoveryMigration).toMatch(/ORDER BY allocation\.property_id, allocation\.booking_request_id,[\s\S]*FOR UPDATE/i);
    expect(financialRecoveryMigration).toMatch(/ORDER BY installment\.property_id, installment\.booking_request_id, installment\.id[\s\S]*FOR UPDATE/i);
    expect(financialRecoveryMigration).toMatch(/RETURNING[\s\S]*old_amount[\s\S]*new_amount/i);
    const repairBlock = financialRecoveryMigration.match(
      /booking_request_net_allocation_repair[\s\S]*?\$booking_request_financial_repair_lock\$/,
    )?.[0];
    expect(repairBlock).not.toContain('ON CONFLICT');
    expect(financialRecoveryMigration).toMatch(/INSERT INTO audit_logs/i);
    expect(financialRecoveryMigration).toMatch(/DELETE FROM booking_request_payment_allocations/i);
    expect(financialRecoveryMigration).toMatch(/UPDATE booking_request_payment_allocations/i);
    expect(financialRecoveryMigration).toMatch(/UPDATE booking_request_installments/i);
    expect(financialRecoveryMigration).toMatch(/allocated_amount\s+IS\s+DISTINCT\s+FROM/i);
    expect(financialRecoveryMigration).toMatch(/status\s+IS\s+DISTINCT\s+FROM/i);
  });
});

describe('booking request email recovery migration safety', () => {
  it('adds stable logical identity, claim recovery, and aggregate ownership', () => {
    expect(emailRecoveryMigration).toContain('ADD COLUMN IF NOT EXISTS logical_key');
    expect(emailRecoveryMigration).toContain('ADD COLUMN IF NOT EXISTS claimed_at');
    expect(emailRecoveryMigration).toContain('booking_request_email_deliveries_logical_key_unique');
    expect(emailRecoveryMigration).toContain('booking_request_email_deliveries_request_fkey');
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
    expect(emailRetryMigration).toContain("ADD VALUE IF NOT EXISTS 'processing'");
    expect(emailRetryMigration).toContain('ADD COLUMN IF NOT EXISTS next_attempt_at');
    expect(emailRetryMigration).toContain('ADD COLUMN IF NOT EXISTS automatic_attempts');
    expect(emailRetryMigration).toContain('ADD COLUMN IF NOT EXISTS provider_message_id');
    expect(emailRetryMigration).toContain('booking_request_email_deliveries_recovery_idx');
    expect(emailRetryMigration).toMatch(/WHERE status IN \('pending', 'processing'\)/i);
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

  it('casts legacy request metadata only after each candidate passes UUID validation', () => {
    for (const candidate of [
      "new_value->>'bookingRequestId'",
      "new_value->>'requestId'",
      "previous_value->>'bookingRequestId'",
      "previous_value->>'requestId'",
    ]) {
      expect(auditRelationshipMigration).toContain(`CASE WHEN ${candidate} ~*`);
      expect(auditRelationshipMigration).toContain(`THEN (${candidate})::uuid END`);
    }
    expect(auditRelationshipMigration).not.toMatch(/NULLIF\([^)]*->>'(?:bookingRequestId|requestId)'[^)]*\)::uuid/);
  });

  it('propagates tombstones only from one unambiguous property/entity relationship', () => {
    expect(auditRelationshipMigration).toContain('unique_request_relationships');
    expect(auditRelationshipMigration).toMatch(/GROUP BY property_id, entity_type, entity_id/i);
    expect(auditRelationshipMigration).toMatch(/HAVING count\(DISTINCT booking_request_id\) = 1/i);
    expect(auditRelationshipMigration).toMatch(/target\.booking_request_id IS NULL/i);
    expect(auditRelationshipMigration).toMatch(/target\.property_id = relationship\.property_id/i);
    expect(auditRelationshipMigration).toMatch(/target\.entity_type = relationship\.entity_type/i);
    expect(auditRelationshipMigration).toMatch(/target\.entity_id = relationship\.entity_id/i);
  });
});

describe('booking request amendment ledger migration safety', () => {
  it('adds immutable correction provenance with a property-scoped charges fkey', () => {
    expect(amendmentLedgerMigration).toContain('ADD COLUMN IF NOT EXISTS adjusts_charge_id');
    expect(amendmentLedgerMigration).toContain('charges_property_id_unique');
    expect(amendmentLedgerMigration).toContain('charges_adjusts_charge_property_fkey');
    expect(amendmentLedgerMigration).toMatch(
      /conname\s*=\s*'charges_adjusts_charge_property_fkey'\s+AND\s+conrelid\s*=\s*'charges'::regclass/i,
    );
    expect(amendmentLedgerMigration).toMatch(
      /FOREIGN KEY \(property_id, adjusts_charge_id\)\s+REFERENCES charges\(property_id, id\)/i,
    );
    expect(amendmentLedgerMigration).not.toMatch(
      /FOREIGN KEY \(adjusts_charge_id\) REFERENCES charges\(id\)/i,
    );
  });

  it('migrates accepted-once identities to include their immutable service date', () => {
    expect(amendmentLedgerMigration).toContain('accepted-pricing:reservation-service:');
    expect(amendmentLedgerMigration).toContain("source_key LIKE 'accepted-pricing:reservation-service:%:once'");
    expect(amendmentLedgerMigration).toMatch(/source_key\s*\|\|\s*':'\s*\|\|\s*to_char\([^)]*service_date AT TIME ZONE 'UTC'/i);
  });

  it('does not rewrite monetary, reversal, or lock state', () => {
    expect(amendmentLedgerMigration).not.toMatch(/SET\s+(amount|is_reversal|is_locked|service_date)\s*=/i);
  });
});

describe('booking request query support migration safety', () => {
  it('ships migration 0032 with submitted-total and audit timeline sequence backfills', () => {
    expect(existsSync(remediationMigrationUrl)).toBe(true);
    const remediationMigration = readFileSync(remediationMigrationUrl, 'utf8');

    expect(remediationMigration).toContain('ADD COLUMN IF NOT EXISTS submitted_total numeric(12,2)');
    expect(remediationMigration).toContain("submitted_quote_snapshot->>'grandTotal'");
    expect(remediationMigration).toContain('ALTER COLUMN submitted_total SET NOT NULL');
    expect(remediationMigration).toContain('booking_requests_property_submitted_total_idx');
    expect(remediationMigration).toContain('ADD COLUMN IF NOT EXISTS timeline_sequence bigint');
    expect(remediationMigration).toMatch(/row_number\(\)\s+OVER\s*\(ORDER BY occurred_at, id\)/i);
    expect(remediationMigration).toContain('ALTER COLUMN timeline_sequence SET NOT NULL');
    expect(remediationMigration).toContain('audit_logs_booking_request_timeline_idx');
  });

  it('backfills both required columns before enforcing their constraints and indexes', () => {
    expect(existsSync(remediationMigrationUrl)).toBe(true);
    const remediationMigration = readFileSync(remediationMigrationUrl, 'utf8');

    const submittedColumn = remediationMigration.indexOf(
      'ADD COLUMN IF NOT EXISTS submitted_total numeric(12,2)',
    );
    const submittedBackfill = remediationMigration.indexOf('UPDATE booking_requests');
    const submittedNotNull = remediationMigration.indexOf(
      'ALTER COLUMN submitted_total SET NOT NULL',
    );
    const submittedIndex = remediationMigration.indexOf(
      'booking_requests_property_submitted_total_idx',
    );
    expect(submittedColumn).toBeGreaterThanOrEqual(0);
    expect(submittedBackfill).toBeGreaterThan(submittedColumn);
    expect(submittedNotNull).toBeGreaterThan(submittedBackfill);
    expect(submittedIndex).toBeGreaterThan(submittedNotNull);

    const timelineColumn = remediationMigration.indexOf(
      'ADD COLUMN IF NOT EXISTS timeline_sequence bigint',
    );
    const timelineBackfill = remediationMigration.indexOf('row_number() OVER');
    const timelineDefault = remediationMigration.indexOf(
      'SET DEFAULT nextval',
    );
    const timelineNotNull = remediationMigration.indexOf(
      'ALTER COLUMN timeline_sequence SET NOT NULL',
    );
    const timelineIndex = remediationMigration.indexOf(
      'audit_logs_booking_request_timeline_idx',
    );
    expect(timelineColumn).toBeGreaterThanOrEqual(0);
    expect(timelineBackfill).toBeGreaterThan(timelineColumn);
    expect(timelineDefault).toBeGreaterThan(timelineBackfill);
    expect(timelineNotNull).toBeGreaterThan(timelineDefault);
    expect(timelineIndex).toBeGreaterThan(timelineNotNull);
  });
});
