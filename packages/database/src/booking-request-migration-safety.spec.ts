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
      expect(source).toContain('audit_logs_booking_request_allocation_repair_unique');
      expect(source).toContain('audit_logs_booking_request_installment_repair_unique');
      expect(source).toContain('booking_request_financial_repair_lock');
      expect(source).toMatch(/ORDER BY parent\.property_id, parent\.booking_request_id, parent\.id[\s\S]*FOR UPDATE/i);
      expect(source).toMatch(/ORDER BY allocation\.property_id, allocation\.booking_request_id,[\s\S]*FOR UPDATE/i);
      expect(source).toMatch(/ORDER BY installment\.property_id, installment\.booking_request_id, installment\.id[\s\S]*FOR UPDATE/i);
      expect(source).toMatch(/RETURNING[\s\S]*old_amount[\s\S]*new_amount/i);
      expect(source).toMatch(/INSERT INTO audit_logs/i);
      expect(source).toMatch(/DELETE FROM booking_request_payment_allocations/i);
      expect(source).toMatch(/UPDATE booking_request_payment_allocations/i);
      expect(source).toMatch(/UPDATE booking_request_installments/i);
      expect(source).toMatch(/allocated_amount\s+IS\s+DISTINCT\s+FROM/i);
      expect(source).toMatch(/status\s+IS\s+DISTINCT\s+FROM/i);
    }
  });
});
