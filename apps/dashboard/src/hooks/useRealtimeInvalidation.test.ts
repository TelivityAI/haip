import { describe, expect, it } from 'vitest';
import { realtimeQueryKeys } from './useRealtimeInvalidation';

describe('booking request realtime invalidation', () => {
  const timestamp = '2026-08-25T09:00:00.000Z';

  it('maps the real room-scoped socket envelope to the active property', () => {
    expect(realtimeQueryKeys('property-1', {
      event: 'booking_request.accepted',
      data: { requestId: 'request-1', reservationId: 'reservation-1', folioId: 'folio-1' },
      timestamp,
    })).toEqual(expect.arrayContaining([
      ['booking-requests', 'property-1'],
      ['booking-requests', 'property-1', 'detail', 'request-1'],
      ['reservations', 'property-1'],
      ['folios', 'property-1'],
      ['booking-request-messages', 'property-1', 'request-1'],
      ['booking-request-audit', 'property-1', 'request-1'],
    ]));
  });

  it.each([
    ['payment.refunded', { bookingRequestId: 'request-1', folioId: 'folio-1' }],
    ['reservation.modified', { reservationId: 'reservation-1' }],
    ['folio.settled', { folioId: 'folio-1' }],
    ['audit.completed', {}],
    ['guest.communication_sent', { bookingRequestId: 'request-1' }],
  ])('refreshes every request workspace for the canonical %s event', (event, data) => {
    expect(realtimeQueryKeys('property-1', { event, data, timestamp })).toContainEqual([
      'booking-requests',
      'property-1',
    ]);
  });

  it('invalidates every property request prefix for a reservation-only payload', () => {
    const keys = realtimeQueryKeys('property-1', {
      event: 'reservation.modified',
      data: { reservationId: 'reservation-1' },
      timestamp,
    });

    expect(keys).toEqual(expect.arrayContaining([
      ['booking-requests', 'property-1'],
      ['booking-request-payments', 'property-1'],
      ['booking-request-installments', 'property-1'],
      ['booking-request-messages', 'property-1'],
      ['booking-request-audit', 'property-1'],
      ['booking-request-folios', 'property-1'],
    ]));
    expect(keys.flat()).not.toContain('property-2');
  });

  it('invalidates request money/messages/audit for canonical payment events only', () => {
    const keys = realtimeQueryKeys('property-1', {
      event: 'payment.refunded',
      data: { bookingRequestId: 'request-1', folioId: 'folio-1' },
      timestamp,
    });
    expect(keys).toEqual(expect.arrayContaining([
      ['payments', 'property-1'],
      ['folios', 'property-1'],
      ['booking-request-payments', 'property-1', 'request-1'],
      ['booking-request-messages', 'property-1', 'request-1'],
      ['booking-request-audit', 'property-1', 'request-1'],
    ]));
    expect(realtimeQueryKeys('property-1', {
      event: 'payment.provider_secret_changed',
      data: {},
      timestamp,
    })).toEqual([]);
  });

  it('never trusts a property carried in event data or returns unscoped keys', () => {
    expect(realtimeQueryKeys(null, {
      event: 'booking_request.created',
      data: { requestId: 'request-1' },
      timestamp,
    })).toEqual([]);
    const keys = realtimeQueryKeys('property-2', {
      event: 'reservation.modified',
      data: {
        bookingRequestId: 'request-1',
        propertyId: 'property-1',
        reservationId: 'reservation-1',
      },
      timestamp,
    });
    expect(keys.every((key) => key.includes('property-2'))).toBe(true);
    expect(keys.some((key) => key.includes('property-1'))).toBe(false);
  });
});
