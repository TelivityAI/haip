import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AriService } from './ari.service';

function createThenableResult(data: any) {
  return {
    then: (fn: any) => Promise.resolve(fn(data)),
    where: vi.fn().mockReturnValue({
      then: (fn: any) => Promise.resolve(fn(data)),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: (fn: any) => Promise.resolve(fn(data)),
        }),
      }),
    }),
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        then: (fn: any) => Promise.resolve(fn(data)),
      }),
    }),
  };
}

describe('AriService', () => {
  let service: AriService;
  let mockDb: any;
  let mockAdapterFactory: any;
  let mockChannelService: any;
  let mockAvailabilityService: any;
  let mockWebhookService: any;
  let mockAdapter: any;

  beforeEach(() => {
    mockAdapter = {
      pushAvailability: vi.fn().mockResolvedValue({ success: true, itemsSynced: 2, errors: [] }),
      pushRates: vi.fn().mockResolvedValue({ success: true, itemsSynced: 2, errors: [] }),
      pushRestrictions: vi.fn().mockResolvedValue({ success: true, itemsSynced: 2, errors: [] }),
    };

    mockAdapterFactory = {
      getAdapter: vi.fn().mockReturnValue(mockAdapter),
    };

    mockChannelService = {
      findById: vi.fn().mockResolvedValue({
        id: 'conn-1',
        propertyId: 'prop-1',
        adapterType: 'mock',
        roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'KING' }],
        ratePlanMapping: [{ ratePlanId: 'rp-1', channelRateCode: 'BAR' }],
        config: {},
      }),
      getActiveConnections: vi.fn().mockResolvedValue([
        {
          id: 'conn-1',
          propertyId: 'prop-1',
          adapterType: 'mock',
          roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'KING' }],
          ratePlanMapping: [{ ratePlanId: 'rp-1', channelRateCode: 'BAR' }],
          config: {},
        },
      ]),
      updateSyncStatus: vi.fn().mockResolvedValue(undefined),
    };

    mockAvailabilityService = {
      searchAvailability: vi.fn().mockResolvedValue([
        { date: '2024-06-01', available: 5, totalRooms: 10, overbookingBuffer: 1 },
        { date: '2024-06-02', available: 3, totalRooms: 10, overbookingBuffer: 1 },
      ]),
    };

    mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };

    const insertResult = { values: vi.fn().mockResolvedValue(undefined) };
    mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 'rp-1', roomTypeId: 'rt-1', baseAmount: '199.99', currencyCode: 'USD' },
          ]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue(insertResult),
    };

    service = new AriService(
      mockDb,
      mockAdapterFactory,
      mockChannelService,
      mockAvailabilityService,
      mockWebhookService,
    );
  });

  describe('pushAvailability', () => {
    it('should push availability to all active connections', async () => {
      const results = await service.pushAvailability('prop-1', '2024-06-01', '2024-06-02');

      expect(results).toHaveLength(1);
      expect(results[0]!.result.success).toBe(true);
      expect(mockAdapter.pushAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyId: 'prop-1',
          channelConnectionId: 'conn-1',
        }),
      );
    });

    it('should push to a specific connection when channelConnectionId provided', async () => {
      const results = await service.pushAvailability('prop-1', '2024-06-01', '2024-06-02', 'conn-1');

      expect(mockChannelService.findById).toHaveBeenCalledWith('conn-1', 'prop-1');
      expect(results).toHaveLength(1);
    });

    it('should apply restricted inventory mode', async () => {
      mockChannelService.getActiveConnections.mockResolvedValue([
        {
          id: 'conn-1',
          adapterType: 'mock',
          roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'KING' }],
          config: { inventoryMode: 'restricted', inventoryPercentage: 50 },
        },
      ]);

      await service.pushAvailability('prop-1', '2024-06-01', '2024-06-02');

      const pushCall = mockAdapter.pushAvailability.mock.calls[0]![0];
      // 5 available * 50% = 2 (floored)
      expect(pushCall.items[0].available).toBe(2);
    });

    it('should exclude overbooking buffer when allowOverbooking is false', async () => {
      mockChannelService.getActiveConnections.mockResolvedValue([
        {
          id: 'conn-1',
          adapterType: 'mock',
          roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'KING' }],
          config: { allowOverbooking: false },
        },
      ]);

      await service.pushAvailability('prop-1', '2024-06-01', '2024-06-02');

      const pushCall = mockAdapter.pushAvailability.mock.calls[0]![0];
      // 5 available - 1 overbooking buffer = 4
      expect(pushCall.items[0].available).toBe(4);
    });

    it('should log sync and update sync status', async () => {
      await service.pushAvailability('prop-1', '2024-06-01', '2024-06-02');

      expect(mockDb.insert).toHaveBeenCalled(); // logSync
      expect(mockChannelService.updateSyncStatus).toHaveBeenCalledWith('conn-1', 'prop-1', 'success', undefined);
    });

    it('should skip connections with no room type mapping', async () => {
      mockChannelService.getActiveConnections.mockResolvedValue([
        { id: 'conn-1', adapterType: 'mock', roomTypeMapping: [], config: {} },
      ]);

      const results = await service.pushAvailability('prop-1', '2024-06-01', '2024-06-02');

      expect(results).toHaveLength(0);
      expect(mockAdapter.pushAvailability).not.toHaveBeenCalled();
    });
  });

  describe('pushRates', () => {
    it('should push rates and restrictions to channels', async () => {
      // DB returns rate plan and restrictions
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([{ id: 'rp-1', roomTypeId: 'rt-1', baseAmount: '199.99', currencyCode: 'USD' }])
            .mockResolvedValueOnce([]), // no restrictions
        }),
      });

      const results = await service.pushRates('prop-1', '2024-06-01', '2024-06-01');

      expect(results).toHaveLength(1);
      expect(results[0]!.rateResult.success).toBe(true);
      expect(results[0]!.restrictionResult.success).toBe(true);
    });

    it('should apply restrictions (CTA, CTD, stopSell) from database', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([{ id: 'rp-1', roomTypeId: 'rt-1', baseAmount: '199.99', currencyCode: 'USD' }])
            .mockResolvedValueOnce([{
              ratePlanId: 'rp-1',
              startDate: '2024-06-01',
              endDate: '2024-06-30',
              isClosed: true,
              closedToArrival: true,
              closedToDeparture: false,
              minLos: 2,
              maxLos: 7,
            }]),
        }),
      });

      await service.pushRates('prop-1', '2024-06-01', '2024-06-01');

      const restrictionCall = mockAdapter.pushRestrictions.mock.calls[0]![0];
      expect(restrictionCall.items[0].stopSell).toBe(true);
      expect(restrictionCall.items[0].closedToArrival).toBe(true);
      expect(restrictionCall.items[0].minLos).toBe(2);
    });
  });

  describe('pushFullARI', () => {
    it('should push both availability and rates', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([{ id: 'rp-1', roomTypeId: 'rt-1', baseAmount: '199.99', currencyCode: 'USD' }])
            .mockResolvedValueOnce([]),
        }),
      });

      const result = await service.pushFullARI('prop-1', '2024-06-01', '2024-06-02');

      expect(result.availability).toBeDefined();
      expect(result.rates).toBeDefined();
    });
  });

  describe('pushStopSell', () => {
    it('should push zero availability for date range', async () => {
      await service.pushStopSell('conn-1', 'prop-1', '2024-06-01', '2024-06-02');

      const pushCall = mockAdapter.pushAvailability.mock.calls[0]![0];
      expect(pushCall.items.every((item: any) => item.available === 0)).toBe(true);
      expect(pushCall.items.every((item: any) => item.totalInventory === 0)).toBe(true);
    });

    it('should filter by roomTypeId when provided', async () => {
      mockChannelService.findById.mockResolvedValue({
        id: 'conn-1',
        adapterType: 'mock',
        roomTypeMapping: [
          { roomTypeId: 'rt-1', channelRoomCode: 'KING' },
          { roomTypeId: 'rt-2', channelRoomCode: 'QUEEN' },
        ],
      });

      await service.pushStopSell('conn-1', 'prop-1', '2024-06-01', '2024-06-01', 'rt-1');

      const pushCall = mockAdapter.pushAvailability.mock.calls[0]![0];
      expect(pushCall.items).toHaveLength(1);
      expect(pushCall.items[0].channelRoomCode).toBe('KING');
    });
  });

  describe('handleReservationCreated', () => {
    it('should push availability on reservation.created event', async () => {
      const spy = vi.spyOn(service, 'pushAvailability').mockResolvedValue([]);

      await service.handleReservationCreated({
        event: 'reservation.created',
        entityType: 'reservation',
        entityId: 'res-1',
        propertyId: 'prop-1',
        data: { arrivalDate: '2024-06-01', departureDate: '2024-06-03' },
        timestamp: new Date(),
      } as any);

      expect(spy).toHaveBeenCalledWith('prop-1', '2024-06-01', '2024-06-03');
    });

    it('should ignore events without propertyId', async () => {
      const spy = vi.spyOn(service, 'pushAvailability');

      await service.handleReservationCreated({
        event: 'reservation.created',
        entityType: 'reservation',
        entityId: 'res-1',
        data: {},
        timestamp: new Date(),
      } as any);

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
