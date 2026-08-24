import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequests,
  bookingRequestInstallments,
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
    expect(bookingEngineConfig.bookingMode).toBeDefined();
    expect(bookingEngineConfig.paymentMethodCollection).toBeDefined();
    expect(payments.bookingRequestId).toBeDefined();
    expect(payments.idempotencyKey).toBeDefined();
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

    const deliveryIndexNames = getTableConfig(webhookDeliveries)
      .indexes.map((index) => index.config.name);
    expect(deliveryIndexNames).toContain(
      'webhook_deliveries_property_subscription_logical_event_unique',
    );
  });
});
