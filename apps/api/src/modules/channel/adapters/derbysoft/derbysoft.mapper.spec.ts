import { describe, it, expect } from 'vitest';
import {
  collapseDateRanges,
  mapAvailabilityToInventory,
  mapRatesToDerbySoft,
  mapRestrictionsToAvailability,
  mapDerbySoftReservationToHaip,
  mapCancelToHaip,
} from './derbysoft.mapper';

describe('derbysoft.mapper', () => {
  describe('collapseDateRanges', () => {
    it('merges consecutive same-value dates', () => {
      const ranges = collapseDateRanges(
        [
          { date: '2026-04-01', available: 5 },
          { date: '2026-04-02', available: 5 },
          { date: '2026-04-03', available: 3 },
        ],
        (i) => String(i.available),
      );
      expect(ranges).toHaveLength(2);
      expect(ranges[0]).toMatchObject({ startDate: '2026-04-01', endDate: '2026-04-02' });
      expect(ranges[1]).toMatchObject({ startDate: '2026-04-03', endDate: '2026-04-03' });
    });
  });

  describe('mapAvailabilityToInventory', () => {
    it('builds inventory payloads per room', () => {
      const payloads = mapAvailabilityToInventory(
        'HOTEL1',
        [
          { channelRoomCode: 'KING', date: '2026-04-01', available: 4, totalInventory: 10 },
          { channelRoomCode: 'KING', date: '2026-04-02', available: 4, totalInventory: 10 },
        ],
        'Delta',
      );
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toMatchObject({
        hotelId: 'HOTEL1',
        roomId: 'KING',
        type: 'Delta',
      });
      expect((payloads[0]!['inventories'] as unknown[]).length).toBe(1);
    });
  });

  describe('mapRatesToDerbySoft', () => {
    it('includes adult occupancy amounts', () => {
      const payloads = mapRatesToDerbySoft(
        'HOTEL1',
        [
          {
            channelRoomCode: 'KING',
            channelRateCode: 'BAR',
            date: '2026-04-01',
            amount: 120,
            currencyCode: 'USD',
          },
        ],
        'Overlay',
      );
      expect(payloads[0]).toMatchObject({ type: 'Overlay', rateId: 'BAR', currencyCode: 'USD' });
      const rates = payloads[0]!['rates'] as Array<{ baseByGuestAmts: unknown[] }>;
      expect(rates[0]!.baseByGuestAmts).toHaveLength(2);
    });
  });

  describe('mapRestrictionsToAvailability', () => {
    it('maps stopSell to masterClose', () => {
      const payloads = mapRestrictionsToAvailability(
        'HOTEL1',
        [
          {
            channelRoomCode: 'KING',
            channelRateCode: 'BAR',
            date: '2026-04-01',
            stopSell: true,
            closedToArrival: false,
            closedToDeparture: true,
            minLos: 2,
          },
        ],
        'Delta',
      );
      const restrictions = payloads[0]!['restrictions'] as Array<Record<string, unknown>>;
      expect(restrictions[0]).toMatchObject({
        masterClose: true,
        closedToDeparture: true,
        minStayArrival: 2,
      });
    });
  });

  describe('mapDerbySoftReservationToHaip', () => {
    it('maps book payload and strips payment (PCI)', () => {
      const mapped = mapDerbySoftReservationToHaip(
        {
          reservationIds: { distributorResId: 'D1', derbyResId: 'DR1' },
          distributorId: 'CTRIP',
          hotelId: 'HOTEL1',
          stayRange: { checkin: '2026-05-01', checkout: '2026-05-03' },
          contactPerson: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
          roomCriteria: { adultCount: 2, childCount: 0 },
          total: { amountAfterTax: '300' },
          roomRate: { roomId: 'KING', rateId: 'BAR', currency: 'USD' },
          guests: [{ firstNameRoma: 'ADA', lastNameRoma: 'LOVELACE' }],
          payment: {
            cardCode: 'VI',
            cardNumber: '4111111111111111',
            cardHolderName: 'Ada',
            expireDate: '1228',
          },
          comments: ['high floor'],
        },
        'new',
      );

      expect(mapped.externalConfirmation).toBe('DR1');
      expect(mapped.channelCode).toBe('derbysoft:CTRIP');
      expect(mapped.channelHotelId).toBe('HOTEL1');
      expect(mapped.guestFirstName).toBe('ADA');
      expect(mapped.totalAmount).toBe(300);
      expect(mapped.specialRequests).toBe('high floor');
      expect(mapped.rawPayload).not.toHaveProperty('payment');
      expect(JSON.stringify(mapped.rawPayload)).not.toContain('4111111111111111');
    });
  });

  describe('mapCancelToHaip', () => {
    it('sets cancelled status', () => {
      const mapped = mapCancelToHaip({
        reservationIds: { derbyResId: 'DR1' },
        distributorId: 'EXPEDIA',
        hotelId: 'HOTEL1',
      });
      expect(mapped.status).toBe('cancelled');
      expect(mapped.channelCode).toBe('derbysoft:EXPEDIA');
    });
  });
});
