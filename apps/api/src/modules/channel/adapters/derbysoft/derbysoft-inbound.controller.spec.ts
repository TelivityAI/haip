import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DerbySoftInboundController } from './derbysoft-inbound.controller';

describe('DerbySoftInboundController', () => {
  let controller: DerbySoftInboundController;
  let inboundReservationService: { processInboundReservation: ReturnType<typeof vi.fn> };
  let availabilityService: { searchAvailability: ReturnType<typeof vi.fn> };
  let dbSelect: ReturnType<typeof vi.fn>;

  const connection = {
    id: 'conn-1',
    propertyId: 'prop-1',
    adapterType: 'derbysoft',
    status: 'active',
    config: {
      hotelId: 'HOTEL1',
      inboundAuth: { bearerToken: 'secret' },
    },
    roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'KING' }],
    ratePlanMapping: [{ ratePlanId: 'rp-1', channelRateCode: 'BAR' }],
  };

  beforeEach(() => {
    inboundReservationService = {
      processInboundReservation: vi.fn().mockResolvedValue({ confirmationNumber: 'HAIP-99' }),
    };
    availabilityService = {
      searchAvailability: vi.fn().mockResolvedValue([
        { date: '2026-05-01', available: 3 },
        { date: '2026-05-02', available: 2 },
      ]),
    };
    dbSelect = vi.fn().mockReturnValue({
      from: () => ({
        where: async () => [connection],
      }),
    });

    controller = new DerbySoftInboundController(
      { select: dbSelect } as any,
      inboundReservationService as any,
      availabilityService as any,
      {
        get: (key: string, def?: string) => (key === 'AUTH_ENABLED' ? 'true' : def),
      } as any,
    );
  });

  function mockRes() {
    const res: any = {
      statusCode: 200,
      body: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    return res;
  }

  it('rejects book without matching hotelId', async () => {
    const res = mockRes();
    await controller.book(
      {
        headers: { authorization: 'Bearer secret' },
        body: {
          header: { echoToken: 'e1' },
          hotelId: 'UNKNOWN',
          reservationIds: { derbyResId: 'DR1', distributorResId: 'D1' },
          stayRange: { checkin: '2026-05-01', checkout: '2026-05-03' },
          contactPerson: { firstName: 'A', lastName: 'B' },
          roomCriteria: { adultCount: 1 },
          total: { amountAfterTax: '100' },
          roomRate: { roomId: 'KING', rateId: 'BAR', currency: 'USD' },
          guests: [{ firstName: 'A', lastName: 'B' }],
          distributorId: 'CTRIP',
        },
      },
      res,
    );
    // find returns connection only when hotelId matches — UNKNOWN → null
    dbSelect.mockReturnValue({
      from: () => ({
        where: async () => [connection],
      }),
    });
    // Re-run with find that won't match — connection hotelId is HOTEL1
    expect(res.statusCode).toBe(500);
    expect(res.body.errorCode).toBe('InvalidField');
  });

  it('rejects unauthorized bearer', async () => {
    const res = mockRes();
    await controller.book(
      {
        headers: { authorization: 'Bearer wrong' },
        body: {
          header: { echoToken: 'e1' },
          hotelId: 'HOTEL1',
          reservationIds: { derbyResId: 'DR1', distributorResId: 'D1' },
          stayRange: { checkin: '2026-05-01', checkout: '2026-05-03' },
          contactPerson: { firstName: 'A', lastName: 'B' },
          roomCriteria: { adultCount: 1 },
          total: { amountAfterTax: '100' },
          roomRate: { roomId: 'KING', rateId: 'BAR', currency: 'USD' },
          guests: [{ firstName: 'A', lastName: 'B' }],
          distributorId: 'CTRIP',
        },
      },
      res,
    );
    expect(res.statusCode).toBe(401);
  });

  it('books when hotel + bearer match', async () => {
    const res = mockRes();
    await controller.book(
      {
        headers: { authorization: 'Bearer secret' },
        body: {
          header: { echoToken: 'e1' },
          hotelId: 'HOTEL1',
          reservationIds: { derbyResId: 'DR1', distributorResId: 'D1' },
          stayRange: { checkin: '2026-05-01', checkout: '2026-05-03' },
          contactPerson: { firstName: 'A', lastName: 'B' },
          roomCriteria: { adultCount: 1 },
          total: { amountAfterTax: '100' },
          roomRate: { roomId: 'KING', rateId: 'BAR', currency: 'USD' },
          guests: [{ firstName: 'A', lastName: 'B' }],
          distributorId: 'CTRIP',
          payment: { cardNumber: '4111111111111111' },
        },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.reservationIds.supplierResId).toBe('HAIP-99');
    expect(inboundReservationService.processInboundReservation).toHaveBeenCalled();
    const mapped = inboundReservationService.processInboundReservation.mock.calls[0]![1];
    expect(mapped.rawPayload).not.toHaveProperty('payment');
  });

  it('liveCheck returns roomRates from availability', async () => {
    const res = mockRes();
    await controller.liveCheck(
      {
        headers: { authorization: 'Bearer secret' },
        body: {
          header: { echoToken: 'e1' },
          hotelId: 'HOTEL1',
          stayRange: { checkin: '2026-05-01', checkout: '2026-05-03' },
        },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.roomRates).toHaveLength(1);
    expect(res.body.roomRates[0].inventory.availableInvCount).toBe(2);
  });
});
