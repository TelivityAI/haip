/**
 * Ported from PR #347's packages/database/src/booking-request-schema.spec.ts
 * (https://github.com/TelivityAI/haip/pull/347), adapted for the standalone
 * @telivityhaip/booking-requests package: only asserts the Drizzle table
 * config this package itself owns (booking_requests and its child tables).
 * Columns #347 added directly to core tables (payments, charges, audit_logs,
 * reservations, webhook_deliveries) are core's own schema and are core's own
 * test responsibility — they are not re-asserted here.
 */
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequestStayAmendments,
  bookingRequests,
} from './schema/index.js';

describe('booking request schema', () => {
  it('exports request persistence with its idempotency and pricing snapshot columns', () => {
    expect(bookingRequests.propertyId).toBeDefined();
    expect(bookingRequests.submittedQuoteSnapshot).toBeDefined();
    expect(bookingRequests.submissionIdempotencyKey).toBeDefined();
    expect(bookingRequests.submissionFingerprint).toBeDefined();
    expect(bookingRequests.submittedTotal).toBeDefined();
    expect(bookingRequests.submittedTotal.notNull).toBe(true);
    expect(bookingRequests.setupIntentId).toBeDefined();

    const indexNames = getTableConfig(bookingRequests).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('booking_requests_property_submission_key_unique');
    expect(indexNames).toContain('booking_requests_setup_intent_unique');
    expect(indexNames).toContain('booking_requests_property_submitted_total_idx');
  });

  it('exports the durable consequence outbox with its request ownership fkey', () => {
    expect(bookingRequestConsequences.propertyId).toBeDefined();
    expect(bookingRequestConsequences.bookingRequestId).toBeDefined();
    expect(bookingRequestConsequences.kind).toBeDefined();
    expect(bookingRequestConsequences.payload).toBeDefined();
    expect(bookingRequestConsequences.status).toBeDefined();
    expect(bookingRequestConsequences.attempts).toBeDefined();
    expect(bookingRequestConsequences.claimedAt).toBeDefined();
    expect(bookingRequestConsequences.lastError).toBeDefined();
    expect(bookingRequestConsequences.completedAt).toBeDefined();

    const consequenceIndexNames = getTableConfig(bookingRequestConsequences)
      .indexes.map((index) => index.config.name);
    expect(consequenceIndexNames).toContain(
      'booking_request_consequences_property_request_kind_unique',
    );
    expect(getTableConfig(bookingRequestConsequences).foreignKeys.map((key) => key.getName()))
      .toContain('booking_request_consequences_request_fkey');
  });

  it('exports installments with amount/milestone/allocation checks and their request fkey', () => {
    expect(bookingRequestInstallments.dueMilestone).toBeDefined();

    const installmentChecks = getTableConfig(bookingRequestInstallments)
      .checks.map((check) => check.name);
    expect(installmentChecks).toEqual(expect.arrayContaining([
      'booking_request_installments_amount_kind_check',
      'booking_request_installments_milestone_date_check',
      'booking_request_installments_allocated_nonnegative_check',
    ]));
    expect(getTableConfig(bookingRequestInstallments).foreignKeys.map((key) => key.getName()))
      .toContain('booking_request_installments_request_fkey');
  });

  it('exports payment allocations with a positive-amount check and its ownership fkeys', () => {
    const allocationChecks = getTableConfig(bookingRequestPaymentAllocations)
      .checks.map((check) => check.name);
    expect(allocationChecks).toContain('booking_request_payment_allocations_positive_check');
    expect(getTableConfig(bookingRequestPaymentAllocations).foreignKeys.map((key) => key.getName()))
      .toEqual(expect.arrayContaining([
        'booking_request_payment_allocations_request_fkey',
        'booking_request_payment_allocations_payment_fkey',
        'booking_request_payment_allocations_installment_fkey',
      ]));
  });

  it('exports payment resolutions with idempotency, lifecycle, and movement-ownership guarantees', () => {
    expect(bookingRequestPaymentResolutions.status).toBeDefined();
    expect(bookingRequestPaymentResolutions.idempotencyKey).toBeDefined();
    expect(bookingRequestPaymentResolutions.operationFingerprint).toBeDefined();
    expect(bookingRequestPaymentResolutions.providerTransactionId).toBeDefined();
    expect(bookingRequestPaymentResolutions.providerStatus).toBeDefined();
    expect(bookingRequestPaymentResolutions.movementId).toBeDefined();
    expect(bookingRequestPaymentResolutions.attempts).toBeDefined();
    expect(bookingRequestPaymentResolutions.lastError).toBeDefined();

    const resolutionConfig = getTableConfig(bookingRequestPaymentResolutions);
    expect(resolutionConfig.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'booking_request_payment_resolutions_positive_check',
      'booking_request_payment_resolutions_status_check',
      'booking_request_payment_resolutions_retained_reason_check',
      'booking_request_payment_resolutions_lifecycle_check',
    ]));
    expect(resolutionConfig.indexes.map((index) => index.config.name)).toContain(
      'booking_request_payment_resolutions_property_idempotency_unique',
    );
    expect(resolutionConfig.foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        'booking_request_payment_resolutions_request_fkey',
        'booking_request_payment_resolutions_payment_fkey',
        'booking_request_payment_resolutions_parent_movement_fkey',
      ]),
    );
  });

  it('exports stay amendments with immutable-correction idempotency and ownership fkeys', () => {
    expect(bookingRequestStayAmendments.operationFingerprint).toBeDefined();
    expect(bookingRequestStayAmendments.previewToken).toBeDefined();
    expect(bookingRequestStayAmendments.previousPricingSnapshot).toBeDefined();
    expect(bookingRequestStayAmendments.newPricingSnapshot).toBeDefined();

    const amendmentConfig = getTableConfig(bookingRequestStayAmendments);
    expect(amendmentConfig.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'booking_request_stay_amendments_property_idempotency_unique',
        'br_stay_amendments_property_request_fingerprint_unique',
      ]),
    );
    expect(amendmentConfig.foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        'booking_request_stay_amendments_request_fkey',
        'booking_request_stay_amendments_reservation_fkey',
        'booking_request_stay_amendments_folio_fkey',
      ]),
    );
  });

  it('exports email deliveries with logical-key idempotency, retry recovery, and their request fkey', () => {
    expect(bookingRequestEmailDeliveries.logicalKey).toBeDefined();
    expect(bookingRequestEmailDeliveries.claimedAt).toBeDefined();
    expect(bookingRequestEmailDeliveries.nextAttemptAt).toBeDefined();
    expect(bookingRequestEmailDeliveries.automaticAttempts).toBeDefined();
    expect(bookingRequestEmailDeliveries.providerMessageId).toBeDefined();
    expect(bookingRequestEmailDeliveries.status.enumValues).toContain('processing');

    const emailConfig = getTableConfig(bookingRequestEmailDeliveries);
    expect(emailConfig.indexes.map((index) => index.config.name)).toContain(
      'booking_request_email_deliveries_logical_key_unique',
    );
    expect(emailConfig.indexes.map((index) => index.config.name)).toContain(
      'booking_request_email_deliveries_recovery_idx',
    );
    expect(emailConfig.foreignKeys.map((key) => key.getName())).toContain(
      'booking_request_email_deliveries_request_fkey',
    );
  });
});
