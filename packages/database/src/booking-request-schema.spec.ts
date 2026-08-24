import { describe, expect, it } from 'vitest';
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
    expect(bookingRequestInstallments.dueMilestone).toBeDefined();
    expect(bookingEngineConfig.bookingMode).toBeDefined();
    expect(bookingEngineConfig.paymentMethodCollection).toBeDefined();
    expect(payments.bookingRequestId).toBeDefined();
    expect(payments.idempotencyKey).toBeDefined();
  });
});
