import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InboundReservationService } from './inbound-reservation.service';
import type { ChannelReservation } from './channel-adapter.interface';

function makeReservation(overrides: Partial<ChannelReservation> = {}): ChannelReservation {
  return {
    externalConfirmation: 'BDC-12345',
    channelCode: 'booking_com',
    guestFirstName: 'John',
    guestLastName: 'Smith',
    guestEmail: 'john@example.com',
    channelRoomCode: 'KING',
    channelRateCode: 'BAR',
    arrivalDate: '2024-06-01',
    departureDate: '2024-06-05',
    adults: 2,
    children: 0,
    totalAmount: 799.96,
    currencyCode: 'USD',
    status: 'new',
    channelBookingDate: new Date(),
    ...overrides,
  };
}

describe('InboundReservationService', () => {
  let service: InboundReservationService;
  let mockDb: any;
  let mockChannelService: any;
  let mockAdapterFactory: any;
  let mockAriService: any;
  let mockWebhookService: any;

  const mockConnection = {
    id: 'conn-1',
    propertyId: 'prop-1',
    adapterType: 'mock',
    channelCode: 'booking_com',
    roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'KING' }],
    ratePlanMapping: [{ ratePlanId: 'rp-1', channelRateCode: 'BAR' }],
  };

  beforeEach(() => {
    // Track which .from() table is being queried.
    // After the FK-ownership fix in inbound-reservation.service, handleNewReservation
    // now runs TWO extra selects (roomTypes + ratePlans same-property checks) BEFORE
    // the transaction. Each must return a row so the FK guard passes and we reach
    // the actual booking/guest flow the test is asserting on.
    let selectCallCount = 0;
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([mockConnection]);
            if (selectCallCount === 2) return Promise.resolve([]); // no existing booking (dedup check)
            if (selectCallCount === 3) return Promise.resolve([{ id: 'rt-1' }]);  // roomTypes FK OK
            if (selectCallCount === 4) return Promise.resolve([{ id: 'rp-1' }]);  // ratePlans FK OK
            if (selectCallCount === 5) return Promise.resolve([]); // no existing guest by email
            return Promise.resolve([]);
          }),
        })),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          returning: vi.fn()
            .mockResolvedValueOnce([{ id: 'guest-1', firstName: 'John', lastName: 'Smith' }])
            .mockResolvedValueOnce([{ id: 'booking-1', confirmationNumber: 'CH-ABC-XYZ' }])
            .mockResolvedValueOnce([{ id: 'res-1', bookingId: 'booking-1', guestId: 'guest-1' }]),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'res-1' }]),
          }),
        }),
      }),
    };
    // Transactions just run the callback with the same mock — the tx-scoped insert/select
    // queries still hit the shared mocks configured above.
    mockDb.transaction = vi.fn().mockImplementation((cb: any) => cb(mockDb));

    mockChannelService = {
      findById: vi.fn().mockResolvedValue(mockConnection),
    };

    mockAdapterFactory = {
      getAdapter: vi.fn().mockReturnValue({
        confirmReservation: vi.fn().mockResolvedValue({ success: true, itemsSynced: 1, errors: [] }),
        pullReservations: vi.fn().mockResolvedValue({ success: true, reservations: [], errors: [] }),
      }),
    };

    mockAriService = {
      pushAvailability: vi.fn().mockResolvedValue([]),
    };

    mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };

    service = new InboundReservationService(
      mockDb,
      mockChannelService,
      mockAdapterFactory,
      mockAriService,
      mockWebhookService,
    );
  });

  describe('processInboundReservation - new', () => {
    it('should create a new reservation from channel data', async () => {
      const reservation = makeReservation();
      const result = await service.processInboundReservation('conn-1', reservation);

      expect(result.bookingId).toBeDefined();
      expect(result.guestId).toBeDefined();
      expect(result.confirmationNumber).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should emit channel.reservation_received webhook', async () => {
      const reservation = makeReservation();
      await service.processInboundReservation('conn-1', reservation);

      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'channel.reservation_received',
        'reservation',
        expect.any(String),
        expect.objectContaining({
          channelCode: 'booking_com',
          externalConfirmation: 'BDC-12345',
          status: 'new',
        }),
        'prop-1',
      );
    });

    it('should confirm reservation back to channel', async () => {
      const reservation = makeReservation();
      await service.processInboundReservation('conn-1', reservation);

      const adapter = mockAdapterFactory.getAdapter('mock');
      expect(adapter.confirmReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          channelConnectionId: 'conn-1',
          externalConfirmation: 'BDC-12345',
        }),
      );
    });

    it('should push updated availability after creating reservation', async () => {
      const reservation = makeReservation();
      await service.processInboundReservation('conn-1', reservation);

      expect(mockAriService.pushAvailability).toHaveBeenCalledWith(
        'prop-1',
        '2024-06-01',
        '2024-06-05',
      );
    });

    it('should throw ConflictException for duplicate reservation', async () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockConnection]); // connection
            if (callCount === 2) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'EXIST-123' }]); // existing booking found!
            return Promise.resolve([]);
          }),
        }),
      }));

      const reservation = makeReservation();
      await expect(service.processInboundReservation('conn-1', reservation))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('processInboundReservation - cancelled', () => {
    it('should cancel an existing reservation', async () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockConnection]); // connection
            if (callCount === 2) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'CH-123' }]); // existing booking
            if (callCount === 3) return Promise.resolve([{ id: 'res-1', bookingId: 'booking-1' }]); // existing reservation
            return Promise.resolve([]);
          }),
        }),
      }));

      const reservation = makeReservation({ status: 'cancelled' });
      const result = await service.processInboundReservation('conn-1', reservation);

      expect(result.cancelled).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when cancelling non-existent reservation', async () => {
      // Connection found, booking NOT found
      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockConnection]);
            return Promise.resolve([]); // no existing booking
          }),
        }),
      }));

      const reservation = makeReservation({ status: 'cancelled' });
      await expect(service.processInboundReservation('conn-1', reservation))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('processInboundReservation - modified', () => {
    it('should update an existing reservation', async () => {
      // After FK-ownership fix, handleModification runs 2 extra selects (roomTypes
      // + ratePlans same-property checks). Sequence: connection, existing booking,
      // existing reservation, roomTypes FK, ratePlans FK.
      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockConnection]);
            if (callCount === 2) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'CH-123' }]);
            if (callCount === 3) return Promise.resolve([{ id: 'res-1', bookingId: 'booking-1', guestId: 'guest-1' }]);
            if (callCount === 4) return Promise.resolve([{ id: 'rt-1' }]);  // roomTypes FK OK
            if (callCount === 5) return Promise.resolve([{ id: 'rp-1' }]);  // ratePlans FK OK
            return Promise.resolve([]);
          }),
        }),
      }));

      const reservation = makeReservation({ status: 'modified', totalAmount: 999.99 });
      const result = await service.processInboundReservation('conn-1', reservation);

      expect(result.confirmationNumber).toBe('CH-123');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('processInboundReservation - mapping errors', () => {
    it('should throw when channel room code has no mapping', async () => {
      const connNoMapping = { ...mockConnection, roomTypeMapping: [] };
      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([connNoMapping]);
            if (callCount === 2) return Promise.resolve([]); // no existing booking
            if (callCount === 3) return Promise.resolve([]); // no existing guest
            return Promise.resolve([]);
          }),
        }),
      }));

      const reservation = makeReservation();
      await expect(service.processInboundReservation('conn-1', reservation))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('pullAndProcessReservations', () => {
    it('should pull reservations from channel and process them', async () => {
      const adapter = mockAdapterFactory.getAdapter('mock');
      adapter.pullReservations.mockResolvedValue({
        success: true,
        reservations: [makeReservation()],
        errors: [],
      });

      const spy = vi.spyOn(service, 'processInboundReservation').mockResolvedValue({
        reservationId: 'res-1',
        bookingId: 'booking-1',
        confirmationNumber: 'CH-123',
        guestId: 'guest-1',
      });

      const result = await service.pullAndProcessReservations('conn-1', 'prop-1');

      expect(result.total).toBe(1);
      expect(result.processed[0]!.status).toBe('processed');
      expect(spy).toHaveBeenCalled();
    });

    it('should handle errors gracefully during pull processing', async () => {
      const adapter = mockAdapterFactory.getAdapter('mock');
      adapter.pullReservations.mockResolvedValue({
        success: true,
        reservations: [makeReservation()],
        errors: [],
      });

      vi.spyOn(service, 'processInboundReservation').mockRejectedValue(new Error('DB error'));

      const result = await service.pullAndProcessReservations('conn-1', 'prop-1');

      expect(result.total).toBe(1);
      expect(result.processed[0]!.status).toBe('failed');
      expect(result.processed[0]!.error).toBe('DB error');
    });
  });

  describe('guest resolution', () => {
    it('should find existing guest by email', async () => {
      // After FK-ownership fix, handleNewReservation runs 2 extra selects (roomTypes
      // + ratePlans FK checks) BEFORE the guest-by-email lookup.
      let callCount = 0;
      const existingGuest = { id: 'guest-existing', firstName: 'John', email: 'john@example.com' };
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockConnection]);
            if (callCount === 2) return Promise.resolve([]); // no existing booking
            if (callCount === 3) return Promise.resolve([{ id: 'rt-1' }]);  // roomTypes FK OK
            if (callCount === 4) return Promise.resolve([{ id: 'rp-1' }]);  // ratePlans FK OK
            if (callCount === 5) return Promise.resolve([existingGuest]);   // existing guest by email
            if (callCount === 6) return Promise.resolve([{ id: 'res-link' }]); // linked at THIS property → reuse
            return Promise.resolve([]);
          }),
        }),
      }));

      // Booking and reservation inserts still need to work
      mockDb.insert.mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn()
            .mockResolvedValueOnce([{ id: 'booking-1', confirmationNumber: 'CH-TEST' }])
            .mockResolvedValueOnce([{ id: 'res-1' }]),
        }),
      }));

      const reservation = makeReservation();
      const result = await service.processInboundReservation('conn-1', reservation);

      expect(result.guestId).toBe('guest-existing');
    });

    it('should NOT reuse a guest with no reservation link at this property', async () => {
      let callCount = 0;
      const foreignGuest = { id: 'guest-foreign', firstName: 'John', email: 'john@example.com' };
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockConnection]);
            if (callCount === 2) return Promise.resolve([]); // no existing booking
            if (callCount === 3) return Promise.resolve([{ id: 'rt-1' }]); // roomTypes FK OK
            if (callCount === 4) return Promise.resolve([{ id: 'rp-1' }]); // ratePlans FK OK
            if (callCount === 5) return Promise.resolve([foreignGuest]); // email matches a guest...
            if (callCount === 6) return Promise.resolve([]); // ...but NO reservation link at this property
            return Promise.resolve([]);
          }),
        }),
      }));

      const reservation = makeReservation();
      const result = await service.processInboundReservation('conn-1', reservation);

      // A fresh guest row is created (beforeEach insert mock → 'guest-1'), not the foreign one.
      expect(result.guestId).toBe('guest-1');
    });
  });

  describe('confirmation number entropy', () => {
    it('generates a high-entropy, non-time-derived confirmation number', () => {
      const gen = () => (service as any).generateConfirmationNumber() as string;
      const n = gen();
      // 128-bit Crockford token (CH- + 32 chars), not `CH-<timestamp>-<4 random>`.
      expect(n).toMatch(/^CH-[0-9A-Z]{32}$/);
      const many = new Set(Array.from({ length: 200 }, gen));
      expect(many.size).toBe(200);
    });
  });
});
