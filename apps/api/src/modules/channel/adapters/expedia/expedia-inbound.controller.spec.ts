import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpediaInboundController } from './expedia-inbound.controller';

// Parse + map are stubbed so the test drives the routing decision directly.
vi.mock('./expedia.xml', () => ({ parseExpediaResponse: () => ({ data: {} }) }));
let mockReservations: any[] = [];
vi.mock('./expedia.reservation-mapper', () => ({
  mapExpediaBookingToHaip: () => mockReservations,
}));

function makeRes() {
  const res: any = { statusCode: 0, body: '' };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.send = (b: any) => { res.body = b; return res; };
  return res;
}
const req = { rawBody: '<x/>' };

describe('ExpediaInboundController — tenant routing', () => {
  let inbound: { processInboundReservation: ReturnType<typeof vi.fn> };
  let channel: { findByAdapterType: ReturnType<typeof vi.fn> };
  let controller: ExpediaInboundController;

  beforeEach(() => {
    inbound = { processInboundReservation: vi.fn().mockResolvedValue({ confirmationNumber: 'PMS1' }) };
    channel = { findByAdapterType: vi.fn() };
    controller = new ExpediaInboundController(inbound as any, channel as any);
  });

  it('routes a booking to the connection whose config.hotelId matches', async () => {
    mockReservations = [{ externalConfirmation: 'E1', channelHotelId: 'HOTEL_B' }];
    channel.findByAdapterType.mockResolvedValue([
      { id: 'conn-A', propertyId: 'pA', config: { hotelId: 'HOTEL_A' } },
      { id: 'conn-B', propertyId: 'pB', config: { hotelId: 'HOTEL_B' } },
    ]);

    await controller.receiveBooking(req as any, makeRes());

    expect(inbound.processInboundReservation).toHaveBeenCalledTimes(1);
    expect(inbound.processInboundReservation).toHaveBeenCalledWith('conn-B', expect.objectContaining({ externalConfirmation: 'E1' }));
  });

  it('rejects a booking when no connection matches the hotelId (no default to [0])', async () => {
    mockReservations = [{ externalConfirmation: 'E2', channelHotelId: 'HOTEL_X' }];
    channel.findByAdapterType.mockResolvedValue([
      { id: 'conn-A', propertyId: 'pA', config: { hotelId: 'HOTEL_A' } },
    ]);

    await controller.receiveBooking(req as any, makeRes());

    expect(inbound.processInboundReservation).not.toHaveBeenCalled();
  });

  it('rejects a booking with no hotelId rather than guessing', async () => {
    mockReservations = [{ externalConfirmation: 'E3' }];
    channel.findByAdapterType.mockResolvedValue([
      { id: 'conn-A', propertyId: 'pA', config: { hotelId: 'HOTEL_A' } },
    ]);

    await controller.receiveBooking(req as any, makeRes());

    expect(inbound.processInboundReservation).not.toHaveBeenCalled();
  });
});
