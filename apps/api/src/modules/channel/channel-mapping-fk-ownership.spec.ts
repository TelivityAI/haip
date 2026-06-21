import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChannelService } from './channel.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { ChannelAdapterFactory } from './channel-adapter.factory';

/**
 * Cross-tenant FK ownership for ChannelService.create + update mappings — the
 * roomTypeMapping / ratePlanMapping JSON is operator-supplied. Without a
 * write-time check, a misconfigured (or malicious) mapping pointing at a
 * foreign-tenant id would be persisted on the connection, ultimately producing
 * cross-tenant reservation writes on inbound OTA pushes. (Inbound-reservation
 * already has its own READ-time guard — this is defense in depth.)
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

function mkDb(rows: any[][]) {
  let i = 0;
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(rows[i++] ?? [])),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'conn-1' }]) }),
    }),
    update: vi.fn(),
  };
}

async function mkSvc(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      ChannelService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: ChannelAdapterFactory, useValue: { getAdapter: vi.fn().mockReturnValue({}) } },
    ],
  }).compile();
  return mod.get(ChannelService);
}

describe('ChannelService — cross-tenant mapping FK ownership', () => {
  it('create() rejects when ratePlanMapping contains a foreign ratePlanId', async () => {
    // ratePlans lookup → empty (the one mapped id is not in this property).
    const db = mkDb([[]]);
    const svc = await mkSvc(db);
    await expect(
      svc.create({
        propertyId: A,
        channelCode: 'booking_com',
        channelName: 'Booking.com',
        adapterType: 'booking_com',
        ratePlanMapping: [{ ratePlanId: 'foreign-rp', channelRateCode: 'SM-BAR' }],
        roomTypeMapping: [],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('create() rejects when roomTypeMapping contains a foreign roomTypeId (ratePlanMapping OK or empty)', async () => {
    const db = mkDb([[]]); // roomTypes lookup empty
    const svc = await mkSvc(db);
    await expect(
      svc.create({
        propertyId: A,
        channelCode: 'expedia',
        channelName: 'Expedia',
        adapterType: 'expedia',
        ratePlanMapping: [],
        roomTypeMapping: [{ roomTypeId: 'foreign-rt', channelRoomCode: 'EX-STD' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('update() rejects when the new mapping introduces a foreign roomTypeId', async () => {
    // findById first (returns the existing connection), then roomTypes lookup empty.
    const seq: any[][] = [
      [{ id: 'conn-1', propertyId: A, ratePlanMapping: [], roomTypeMapping: [] }],
      [],
    ];
    const db = mkDb(seq);
    const svc = await mkSvc(db);
    await expect(
      svc.update('conn-1', A, {
        roomTypeMapping: [{ roomTypeId: 'foreign-rt', channelRoomCode: 'X' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });
});
