import { describe, expect, it } from 'vitest';
import { isBookingRequestsEnabled } from '@telivityhaip/shared';
import { paymentHasBookingRequestId } from './booking-request-stripe-handler.interface';

describe('booking-request stripe handler helpers', () => {
  it('detects booking request payments', () => {
    expect(paymentHasBookingRequestId({ bookingRequestId: 'br-1' } as any)).toBe(true);
    expect(paymentHasBookingRequestId({ bookingRequestId: null } as any)).toBe(false);
    expect(paymentHasBookingRequestId({} as any)).toBe(false);
  });

  it('reads HAIP_BOOKING_REQUESTS flag', () => {
    const previous = process.env['HAIP_BOOKING_REQUESTS'];
    process.env['HAIP_BOOKING_REQUESTS'] = 'true';
    expect(isBookingRequestsEnabled()).toBe(true);
    process.env['HAIP_BOOKING_REQUESTS'] = 'false';
    expect(isBookingRequestsEnabled()).toBe(false);
    if (previous === undefined) delete process.env['HAIP_BOOKING_REQUESTS'];
    else process.env['HAIP_BOOKING_REQUESTS'] = previous;
  });
});
