import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InboundReservationService } from './inbound-reservation.service';
import { DRIZZLE } from '../../database/database.module';
import { ChannelService } from './channel.service';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { AriService } from './ari.service';
import { WebhookService } from '../webhook/webhook.service';

/**
 * Cross-tenant FK ownership for channel inbound reservations (follow-on to
 * audit #4-6). The `channelConnections.config.roomTypeMapping` /
 * `ratePlanMapping` JSON is operator-supplied and could (mis)map to a foreign
 * tenant's id. Before this fix, the resolved id was written straight into
 * `reservations` — a live cross-tenant write path.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

function mkDbSeq(rows: any[][]) {
  let i = 0;
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(rows[i++] ?? [])),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
    }),
    update: vi.fn(),
    transaction: vi.fn().mockImplementation(async (cb: any) => cb({} as any)),
  };
}

async function mkSvc(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      InboundReservationService,
      { provide: DRIZZLE, useValue: db },
      { provide: ChannelService, useValue: {} },
      { provide: ChannelAdapterFactory, useValue: {} },
      { provide: AriService, useValue: {} },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
    ],
  }).compile();
  return mod.get(InboundReservationService);
}

describe('InboundReservationService — channel mapping FK ownership', () => {
  // Use the private method via cast — that's the bypass point.
  const conn = {
    id: 'conn-1',
    propertyId: A,
    roomTypeMapping: [{ roomTypeId: 'foreign-rt', channelRoomCode: 'SM-STD' }],
    ratePlanMapping: [{ ratePlanId: 'foreign-rp', channelRateCode: 'SM-BAR' }],
  };
  const reservation: any = {
    externalConfirmation: 'X1',
    channelCode: 'siteminder',
    channelRoomCode: 'SM-STD',
    channelRateCode: 'SM-BAR',
    arrivalDate: '2026-07-01',
    departureDate: '2026-07-03',
    adults: 2,
    totalAmount: 300,
    currencyCode: 'USD',
    guestFirstName: 'A',
    guestLastName: 'B',
  };

  it('handleNewReservation REJECTS when mapping points at a foreign roomTypeId', async () => {
    // First select = FK check on roomTypes → [] (foreign).
    const db = mkDbSeq([[]]);
    const svc = await mkSvc(db);
    await expect(
      (svc as any).handleNewReservation(conn, reservation),
    ).rejects.toBeInstanceOf(BadRequestException);
    // CRITICAL: the transaction MUST NOT have run — no booking/reservation row written.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('handleNewReservation REJECTS when mapping points at a foreign ratePlanId (roomType OK)', async () => {
    const db = mkDbSeq([
      [{ id: 'foreign-rt' }], // roomTypes FK OK (this would mean rt was actually same-property — for the test we pretend)
      [],                      // ratePlans FK empty
    ]);
    // Use a conn where roomTypeId mapping resolves to a "valid" id but ratePlanId is foreign.
    const okRtConn = {
      ...conn,
      roomTypeMapping: [{ roomTypeId: 'rt-1', channelRoomCode: 'SM-STD' }],
    };
    const svc = await mkSvc(db);
    await expect(
      (svc as any).handleNewReservation(okRtConn, reservation),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // Codex re-audit follow-up: handleModification has the same FK check but no test.
  it('handleModification REJECTS when mapping points at a foreign roomTypeId', async () => {
    // 1) existing reservation lookup → row in same property; 2) roomTypes FK → empty (foreign).
    const db = mkDbSeq([
      [{ id: 'r-1', propertyId: A, bookingId: 'b-1' }],
      [],
    ]);
    const svc = await mkSvc(db);
    await expect(
      (svc as any).handleModification(conn, reservation, { id: 'b-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The reservations update MUST NOT have run.
    expect(db.update).not.toHaveBeenCalled();
  });
});
