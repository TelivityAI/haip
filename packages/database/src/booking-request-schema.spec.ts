import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequests,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  charges,
  payments,
  reservations,
  webhookDeliveries,
} from './schema/index.js';

describe('booking request schema', () => {
  it('exports request persistence and backward-compatible config columns', () => {
    expect(bookingRequests.propertyId).toBeDefined();
    expect(bookingRequests.submittedQuoteSnapshot).toBeDefined();
    expect(bookingRequests.submissionIdempotencyKey).toBeDefined();
    expect(bookingRequests.submissionFingerprint).toBeDefined();
    expect(bookingRequests.setupIntentId).toBeDefined();
    expect(bookingRequestConsequences.propertyId).toBeDefined();
    expect(bookingRequestConsequences.bookingRequestId).toBeDefined();
    expect(bookingRequestConsequences.kind).toBeDefined();
    expect(bookingRequestConsequences.payload).toBeDefined();
    expect(bookingRequestConsequences.status).toBeDefined();
    expect(bookingRequestConsequences.attempts).toBeDefined();
    expect(bookingRequestConsequences.claimedAt).toBeDefined();
    expect(bookingRequestConsequences.lastError).toBeDefined();
    expect(bookingRequestConsequences.completedAt).toBeDefined();
    expect(bookingRequestInstallments.dueMilestone).toBeDefined();
    expect(bookingRequestPaymentResolutions.status).toBeDefined();
    expect(bookingRequestPaymentResolutions.idempotencyKey).toBeDefined();
    expect(bookingRequestPaymentResolutions.operationFingerprint).toBeDefined();
    expect(bookingRequestPaymentResolutions.providerTransactionId).toBeDefined();
    expect(bookingRequestPaymentResolutions.providerStatus).toBeDefined();
    expect(bookingRequestPaymentResolutions.movementId).toBeDefined();
    expect(bookingRequestPaymentResolutions.attempts).toBeDefined();
    expect(bookingRequestPaymentResolutions.lastError).toBeDefined();
    expect(bookingEngineConfig.bookingMode).toBeDefined();
    expect(bookingEngineConfig.paymentMethodCollection).toBeDefined();
    expect(payments.bookingRequestId).toBeDefined();
    expect(payments.idempotencyKey).toBeDefined();
    expect(charges.sourceKey).toBeDefined();
    expect(webhookDeliveries.logicalEventId).toBeDefined();
    expect(reservations.acceptedPricingSnapshot).toBeDefined();

    const indexNames = getTableConfig(bookingRequests).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('booking_requests_property_submission_key_unique');
    expect(indexNames).toContain('booking_requests_setup_intent_unique');

    const consequenceIndexNames = getTableConfig(bookingRequestConsequences)
      .indexes.map((index) => index.config.name);
    expect(consequenceIndexNames).toContain(
      'booking_request_consequences_property_request_kind_unique',
    );

    const installmentChecks = getTableConfig(bookingRequestInstallments)
      .checks.map((check) => check.name);
    expect(installmentChecks).toEqual(expect.arrayContaining([
      'booking_request_installments_amount_kind_check',
      'booking_request_installments_milestone_date_check',
      'booking_request_installments_allocated_nonnegative_check',
    ]));
    const allocationChecks = getTableConfig(bookingRequestPaymentAllocations)
      .checks.map((check) => check.name);
    expect(allocationChecks).toContain('booking_request_payment_allocations_positive_check');
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
    expect(getTableConfig(payments).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'payments_booking_request_parent_positive_check',
        'payments_booking_request_child_shape_check',
      ]),
    );

    const deliveryIndexNames = getTableConfig(webhookDeliveries)
      .indexes.map((index) => index.config.name);
    expect(deliveryIndexNames).toContain(
      'webhook_deliveries_property_subscription_logical_event_unique',
    );

    const chargeIndexNames = getTableConfig(charges).indexes.map((index) => index.config.name);
    expect(chargeIndexNames).toContain('charges_property_folio_source_key_unique');
  });
});
