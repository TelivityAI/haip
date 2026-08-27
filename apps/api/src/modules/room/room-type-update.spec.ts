import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoomService } from './room.service';
import { DRIZZLE } from '../../database/database.module';

/**
 * RoomService.updateRoomType — the route that did not exist.
 *
 * Room types were create-only: GET types, POST types, GET types/:id and nothing
 * else. These tests are mostly about the guards REFUSING, because an update
 * that silently succeeds is how a type ends up allowing more guests than the
 * room sleeps, or gets retired out from under rooms that still point at it.
 * Each guard therefore has a rejecting case AND a permitting case, so a guard
 * that refused everything would fail here too.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';
const RT = 'cccccccc-0000-4000-a000-000000000001';

function selectQueue(results: unknown[][]) {
  let i = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const rows = results[i++] ?? [];
        const thenable = Promise.resolve(rows);
        return {
          limit: vi.fn().mockResolvedValue(rows),
          then: thenable.then.bind(thenable),
          catch: thenable.catch.bind(thenable),
        };
      }),
    }),
  }));
}

function updateSpy(returned: unknown = { id: RT }) {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([returned]) }),
    }),
  });
}

async function svcWith(db: any) {
  const mod = await Test.createTestingModule({
    providers: [RoomService, { provide: DRIZZLE, useValue: db }],
  }).compile();
  return mod.get(RoomService);
}

const TYPE = {
  id: RT,
  propertyId: A,
  name: 'Guest Room',
  maxOccupancy: 4,
  defaultOccupancy: 2,
  isActive: true,
};

describe('updateRoomType — tenant scoping', () => {
  it("404s on another property's room type, and writes nothing", async () => {
    const db: any = { select: selectQueue([[]]), update: updateSpy() };
    const svc = await svcWith(db);
    await expect(svc.updateRoomType(RT, A, { name: 'x' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('updateRoomType — occupancy coherence', () => {
  it('rejects a maxOccupancy below the STORED defaultOccupancy', async () => {
    // The merged-state check. dto carries only maxOccupancy, so validating dto
    // alone would let default=2 sit above max=1.
    const db: any = { select: selectQueue([[TYPE]]), update: updateSpy() };
    const svc = await svcWith(db);
    await expect(svc.updateRoomType(RT, A, { maxOccupancy: 1 } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects a defaultOccupancy above the STORED maxOccupancy', async () => {
    const db: any = { select: selectQueue([[TYPE]]), update: updateSpy() };
    const svc = await svcWith(db);
    await expect(
      svc.updateRoomType(RT, A, { defaultOccupancy: 9 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows equal default and max', async () => {
    const db: any = { select: selectQueue([[TYPE], []]), update: updateSpy() };
    const svc = await svcWith(db);
    await svc.updateRoomType(RT, A, { maxOccupancy: 2, defaultOccupancy: 2 } as any);
    expect(db.update).toHaveBeenCalled();
  });
});

describe('updateRoomType — lowering capacity under a booked party', () => {
  it('refuses when an active stay is booked for more guests than the new max', async () => {
    const db: any = {
      // [0] the type, [1] the oversized reservation
      select: selectQueue([[TYPE], [{ id: 'res-1', adults: 3, children: 1 }]]),
      update: updateSpy(),
    };
    const svc = await svcWith(db);
    await expect(svc.updateRoomType(RT, A, { maxOccupancy: 3 } as any)).rejects.toThrow(
      /reservation res-1 .* 4 guests/,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows the reduction when no active stay exceeds the new max', async () => {
    const db: any = { select: selectQueue([[TYPE], []]), update: updateSpy() };
    const svc = await svcWith(db);
    const out = await svc.updateRoomType(RT, A, { maxOccupancy: 3 } as any);
    expect(out).toEqual({ id: RT });
    expect(db.update).toHaveBeenCalled();
  });

  it('does not run the reservation query when capacity is RAISED', async () => {
    // Scope check on the guard itself: a guard that queried on every update
    // would still pass the two tests above while doing needless work, and would
    // block a raise the moment the mock returned a row.
    const db: any = { select: selectQueue([[TYPE]]), update: updateSpy() };
    const svc = await svcWith(db);
    await svc.updateRoomType(RT, A, { maxOccupancy: 6 } as any);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalled();
  });
});

describe('updateRoomType — retiring a type', () => {
  it('refuses to deactivate while a room still points at it', async () => {
    const db: any = {
      // [0] the type, [1] a room still using it
      select: selectQueue([[TYPE], [{ id: 'room-1', number: '201' }]]),
      update: updateSpy(),
    };
    const svc = await svcWith(db);
    await expect(svc.updateRoomType(RT, A, { isActive: false } as any)).rejects.toThrow(
      /room 201 still uses it/,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('deactivates a type no room points at', async () => {
    const db: any = { select: selectQueue([[TYPE], []]), update: updateSpy() };
    const svc = await svcWith(db);
    await svc.updateRoomType(RT, A, { isActive: false } as any);
    expect(db.update).toHaveBeenCalled();
  });

  it('reactivates a retired type without checking rooms', async () => {
    // findRoomTypeById deliberately does not filter isActive, so a retired type
    // stays reachable. isActive:true must not be treated as a deactivation.
    const retired = { ...TYPE, isActive: false };
    const db: any = { select: selectQueue([[retired]]), update: updateSpy() };
    const svc = await svcWith(db);
    await svc.updateRoomType(RT, A, { isActive: true } as any);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalled();
  });
});
