import { describe, expect, it } from 'vitest';
import { realtimeQueryKeys } from './useRealtimeInvalidation';

describe('booking request realtime invalidation', () => {
  it('maps the exact request event catalog to property-scoped aggregate keys', () => {
    expect(realtimeQueryKeys({
      event: 'booking_request.accepted',
      entityId: 'request-1',
      propertyId: 'property-1',
      data: { requestId: 'request-1', reservationId: 'reservation-1', folioId: 'folio-1' },
    })).toEqual(expect.arrayContaining([
      ['booking-requests', 'property-1'],
      ['reservations', 'property-1'],
      ['folios', 'property-1'],
      ['booking-request-messages', 'property-1', 'request-1'],
      ['booking-request-audit', 'property-1', 'request-1'],
    ]));
  });

  it('invalidates request money/messages/audit for canonical payment events only', () => {
    const keys = realtimeQueryKeys({
      event: 'payment.refunded',
      entityId: 'payment-1',
      propertyId: 'property-1',
      data: { bookingRequestId: 'request-1', folioId: 'folio-1' },
    });
    expect(keys).toEqual(expect.arrayContaining([
      ['payments', 'property-1'],
      ['folios', 'property-1'],
      ['booking-request-payments', 'property-1', 'request-1'],
      ['booking-request-messages', 'property-1', 'request-1'],
      ['booking-request-audit', 'property-1', 'request-1'],
    ]));
    expect(realtimeQueryKeys({
      event: 'payment.provider_secret_changed',
      propertyId: 'property-1',
      data: {},
    })).toEqual([]);
  });

  it('never returns unscoped or cross-property keys when property scope is absent', () => {
    expect(realtimeQueryKeys({ event: 'booking_request.created', entityId: 'request-1' })).toEqual([]);
    const keys = realtimeQueryKeys({
      event: 'reservation.modified',
      propertyId: 'property-2',
      entityId: 'reservation-1',
      data: { bookingRequestId: 'request-1' },
    });
    expect(keys.every((key) => key.includes('property-2'))).toBe(true);
    expect(keys.some((key) => key.includes('property-1'))).toBe(false);
  });
});
