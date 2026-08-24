import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  bookingEngineConfig,
  bookingRequests,
  bookingRequestInstallments,
  payments,
} from './schema/index.js';

describe('booking request schema', () => {
  it('exports request persistence and backward-compatible config columns', () => {
    expect(bookingRequests.propertyId).toBeDefined();
    expect(bookingRequests.submittedQuoteSnapshot).toBeDefined();
    expect(bookingRequests.submissionIdempotencyKey).toBeDefined();
    expect(bookingRequests.submissionFingerprint).toBeDefined();
    expect(bookingRequests.setupIntentId).toBeDefined();
    expect(bookingRequestInstallments.dueMilestone).toBeDefined();
    expect(bookingEngineConfig.bookingMode).toBeDefined();
    expect(bookingEngineConfig.paymentMethodCollection).toBeDefined();
    expect(payments.bookingRequestId).toBeDefined();
    expect(payments.idempotencyKey).toBeDefined();

    const indexNames = getTableConfig(bookingRequests).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('booking_requests_property_submission_key_unique');
    expect(indexNames).toContain('booking_requests_setup_intent_unique');
  });
});
