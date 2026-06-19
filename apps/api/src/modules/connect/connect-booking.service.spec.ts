import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConnectBookingService } from './connect-booking.service';

describe('ConnectBookingService', () => {
  let service: ConnectBookingService;
  let mockDb: any;
  let mockAvailabilityService: any;
  let mockWebhookService: any;

  const mockRatePlan = {
    id: 'rp-1',
    propertyId: 'prop-1',
    baseAmount: '199.99',
    currencyCode: 'USD',
    type: 'bar',
    isActive: true,
  };

  beforeEach(() => {
    let insertCallCount = 0;
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            insertCallCount++;
            if (insertCallCount === 1) return Promise.resolve([{ id: 'guest-1', firstName: 'John', lastName: 'Smith' }]); // guest
            if (insertCallCount === 2) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'HAIP-TEST' }]); // booking
            if (insertCallCount === 3) return Promise.resolve([{ id: 'res-1', bookingId: 'booking-1', status: 'confirmed' }]); // reservation
            return Promise.resolve([{ id: 'new-item' }]);
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'res-1', status: 'confirmed', totalAmount: '399.98', updatedAt: new Date() }]),
          }),
        }),
      }),
    };

    mockAvailabilityService = {
      searchAvailability: vi.fn().mockResolvedValue([
        { roomTypeId: 'rt-1', date: '2024-06-01', totalRooms: 50, sold: 20, available: 30, overbookingBuffer: 0 },
        { roomTypeId: 'rt-1', date: '2024-06-02', totalRooms: 50, sold: 25, available: 25, overbookingBuffer: 0 },
      ]),
    };

    mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };
    const mockRatePlanService = { assertSellable: vi.fn().mockResolvedValue(undefined) };

    service = new ConnectBookingService(
      mockDb,
      mockAvailabilityService,
      mockWebhookService,
      mockRatePlanService as any,
    );
  });

  describe('book', () => {
    it('should create guest + booking + reservation and auto-confirm', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([mockRatePlan]); // rate plan
            if (selectCallCount === 2) return Promise.resolve([]); // guest email lookup (not found)
            if (selectCallCount === 3) return Promise.resolve([{ settings: { taxRate: 10 } }]); // property settings
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        checkIn: '2024-06-01',
        checkOut: '2024-06-03',
        guestFirstName: 'John',
        guestLastName: 'Smith',
        guestEmail: 'john@example.com',
        adults: 2,
        agentId: 'otaip-booking-agent',
        externalReference: 'OTAIP-123',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('confirmed');
      expect(result.confirmationNumber).toBeDefined();
      expect(result.confirmationCodes.external).toBe('OTAIP-123');
      expect(result.nightlyBreakdown).toHaveLength(2);
    });

    it('should reuse existing guest matched by email', async () => {
      let selectCallCount = 0;
      const existingGuest = { id: 'guest-existing', firstName: 'John', lastName: 'Smith', email: 'john@example.com' };
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([mockRatePlan]);
            if (selectCallCount === 2) return Promise.resolve([existingGuest]); // guest found by email
            if (selectCallCount === 3) return Promise.resolve([{ id: 'res-existing' }]); // linked at THIS property → reuse
            if (selectCallCount === 4) return Promise.resolve([{ settings: {} }]);
            return Promise.resolve([]);
          }),
        }),
      }));

      // Reset insert count — no guest insert should happen
      let insertCount = 0;
      mockDb.insert.mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            insertCount++;
            if (insertCount === 1) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'HAIP-X' }]);
            if (insertCount === 2) return Promise.resolve([{ id: 'res-1', status: 'confirmed' }]);
            return Promise.resolve([{}]);
          }),
        }),
      }));

      const result = await service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        checkIn: '2024-06-01',
        checkOut: '2024-06-03',
        guestFirstName: 'John',
        guestLastName: 'Smith',
        guestEmail: 'john@example.com',
        adults: 2,
      });

      expect(result.success).toBe(true);
      // Only 2 inserts (booking + reservation), not 3 (guest skipped)
      expect(insertCount).toBe(2);
    });

    it('should NOT reuse a guest from another property (cross-tenant PII guard)', async () => {
      let selectCallCount = 0;
      const foreignGuest = { id: 'guest-foreign', firstName: 'John', lastName: 'Smith', email: 'john@example.com' };
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([mockRatePlan]); // rate plan
            if (selectCallCount === 2) return Promise.resolve([foreignGuest]); // email matches a guest...
            if (selectCallCount === 3) return Promise.resolve([]); // ...but NO reservation link at this property
            if (selectCallCount === 4) return Promise.resolve([{ settings: {} }]); // property settings
            return Promise.resolve([]);
          }),
        }),
      }));

      let insertCount = 0;
      mockDb.insert.mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            insertCount++;
            if (insertCount === 1) return Promise.resolve([{ id: 'guest-new', firstName: 'John', lastName: 'Smith' }]);
            if (insertCount === 2) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'HAIP-X' }]);
            if (insertCount === 3) return Promise.resolve([{ id: 'res-1', status: 'confirmed' }]);
            return Promise.resolve([{}]);
          }),
        }),
      }));

      const result = await service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        checkIn: '2024-06-01',
        checkOut: '2024-06-03',
        guestFirstName: 'John',
        guestLastName: 'Smith',
        guestEmail: 'john@example.com',
        adults: 2,
      });

      expect(result.success).toBe(true);
      // A fresh guest row is created (guest + booking + reservation = 3 inserts),
      // NOT linked to the foreign-property guest.
      expect(insertCount).toBe(3);
    });

    it('should reject booking when no availability', async () => {
      mockAvailabilityService.searchAvailability.mockResolvedValue([
        { roomTypeId: 'rt-1', date: '2024-06-01', totalRooms: 50, sold: 50, available: 0, overbookingBuffer: 0 },
      ]);

      await expect(service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        checkIn: '2024-06-01',
        checkOut: '2024-06-02',
        guestFirstName: 'Jane',
        guestLastName: 'Doe',
        adults: 1,
      })).rejects.toThrow(BadRequestException);
    });

    it('should reject booking with inactive rate plan', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // no rate plan found
        }),
      }));

      await expect(service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-nonexistent',
        checkIn: '2024-06-01',
        checkOut: '2024-06-02',
        guestFirstName: 'Jane',
        guestLastName: 'Doe',
        adults: 1,
      })).rejects.toThrow(NotFoundException);
    });

    it('should emit connect.booking_created webhook', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([mockRatePlan]);
            if (selectCallCount === 2) return Promise.resolve([]);
            if (selectCallCount === 3) return Promise.resolve([{ settings: {} }]);
            return Promise.resolve([]);
          }),
        }),
      }));

      await service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        checkIn: '2024-06-01',
        checkOut: '2024-06-03',
        guestFirstName: 'John',
        guestLastName: 'Smith',
        adults: 2,
        agentId: 'agent-1',
      });

      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'connect.booking_created',
        'reservation',
        expect.any(String),
        expect.objectContaining({ agentId: 'agent-1' }),
        'prop-1',
      );
    });

    it('should set payment status for prepaid bookings', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([mockRatePlan]);
            if (selectCallCount === 2) return Promise.resolve([]);
            if (selectCallCount === 3) return Promise.resolve([{ settings: {} }]);
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.book({
        propertyId: 'prop-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        checkIn: '2024-06-01',
        checkOut: '2024-06-03',
        guestFirstName: 'John',
        guestLastName: 'Smith',
        adults: 2,
        paymentMethod: 'prepaid',
        paymentToken: 'tok_123',
      });

      expect(result.paymentStatus).toBe('authorized');
      expect(result.depositAmount).toBeGreaterThan(0);
    });
  });

  describe('verify', () => {
    it('should return full booking status', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1', confirmationNumber: 'HAIP-123' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', bookingId: 'booking-1', guestId: 'guest-1', roomTypeId: 'rt-1',
              status: 'confirmed', arrivalDate: '2024-06-01', departureDate: '2024-06-03',
              totalAmount: '399.98', currencyCode: 'USD', roomId: null,
              updatedAt: new Date(), createdAt: new Date(),
            }]);
            if (selectCallCount === 3) return Promise.resolve([{ id: 'guest-1', firstName: 'John', lastName: 'Smith' }]);
            if (selectCallCount === 4) return Promise.resolve([{ id: 'rt-1', name: 'Standard King' }]);
            if (selectCallCount === 5) return Promise.resolve([]); // no folio
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.verify('HAIP-123');

      expect(result.status).toBe('confirmed');
      expect(result.confirmationNumber).toBe('HAIP-123');
      expect(result.guestName).toBe('John Smith');
      expect(result.roomType).toBe('Standard King');
      expect(result.roomAssigned).toBe(false);
      expect(result.verifiedAt).toBeDefined();
    });

    it('should include room assignment when available', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', bookingId: 'booking-1', guestId: 'guest-1', roomTypeId: 'rt-1',
              status: 'assigned', arrivalDate: '2024-06-01', departureDate: '2024-06-03',
              totalAmount: '399.98', currencyCode: 'USD', roomId: 'room-101',
              updatedAt: new Date(), createdAt: new Date(),
            }]);
            if (selectCallCount === 3) return Promise.resolve([{ firstName: 'John', lastName: 'Smith' }]);
            if (selectCallCount === 4) return Promise.resolve([{ name: 'Standard King' }]);
            if (selectCallCount === 5) return Promise.resolve([{ number: '101' }]); // room
            if (selectCallCount === 6) return Promise.resolve([]); // folio
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.verify('HAIP-123');

      expect(result.roomAssigned).toBe(true);
      expect(result.roomNumber).toBe('101');
    });

    it('should throw NotFoundException for invalid confirmation number', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }));

      await expect(service.verify('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('modify', () => {
    it('should handle free modifications (guest details only)', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1', propertyId: 'prop-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', bookingId: 'booking-1', guestId: 'guest-1',
              status: 'confirmed', totalAmount: '399.98',
              arrivalDate: '2024-06-01', departureDate: '2024-06-03',
            }]);
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.modify('HAIP-123', {
        specialRequests: 'High floor please',
      });

      expect(result.success).toBe(true);
      expect(result.costDifference).toBe(0);
    });

    it('should re-check availability for date changes', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1', propertyId: 'prop-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', bookingId: 'booking-1', guestId: 'guest-1',
              status: 'confirmed', totalAmount: '399.98', roomTypeId: 'rt-1', ratePlanId: 'rp-1',
              arrivalDate: '2024-06-01', departureDate: '2024-06-03',
            }]);
            if (selectCallCount === 3) return Promise.resolve([mockRatePlan]); // rate plan for re-calc
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.modify('HAIP-123', {
        checkIn: '2024-06-01',
        checkOut: '2024-06-04', // Extended by 1 night
      });

      expect(result.success).toBe(true);
      expect(mockAvailabilityService.searchAvailability).toHaveBeenCalled();
    });

    it('should reject modification of cancelled reservation', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', status: 'cancelled', totalAmount: '399.98',
            }]);
            return Promise.resolve([]);
          }),
        }),
      }));

      await expect(service.modify('HAIP-123', { adults: 3 })).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('should cancel with free cancellation when before deadline', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = futureDate.toISOString().split('T')[0]!;

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1', propertyId: 'prop-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', status: 'confirmed', totalAmount: '399.98', nights: 2,
              arrivalDate: futureDateStr, ratePlanId: 'rp-1',
            }]);
            if (selectCallCount === 3) return Promise.resolve([mockRatePlan]);
            return Promise.resolve([]);
          }),
        }),
      }));

      const result = await service.cancel('HAIP-123', 'Changed plans');

      expect(result.cancelled).toBe(true);
      expect(result.penaltyApplied).toBe(false);
      expect(result.refundAmount).toBe(399.98);
    });

    it('should throw for already cancelled booking', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{ id: 'res-1', status: 'cancelled' }]);
            return Promise.resolve([]);
          }),
        }),
      }));

      await expect(service.cancel('HAIP-123')).rejects.toThrow(BadRequestException);
    });

    it('should emit connect.booking_cancelled webhook', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = futureDate.toISOString().split('T')[0]!;

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve([{ id: 'booking-1', propertyId: 'prop-1' }]);
            if (selectCallCount === 2) return Promise.resolve([{
              id: 'res-1', status: 'confirmed', totalAmount: '199.99', nights: 1,
              arrivalDate: futureDateStr, ratePlanId: 'rp-1',
            }]);
            if (selectCallCount === 3) return Promise.resolve([mockRatePlan]);
            return Promise.resolve([]);
          }),
        }),
      }));

      await service.cancel('HAIP-123', 'Test');

      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'connect.booking_cancelled',
        'reservation',
        'res-1',
        expect.objectContaining({ reason: 'Test' }),
        'prop-1',
      );
    });
  });
});
