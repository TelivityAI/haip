import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoomService } from './room.service';
import { DRIZZLE } from '../../database/database.module';

/**
 * Cross-tenant FK ownership for RoomService.createRoom (security audit #5).
 * Before the fix: dto.roomTypeId from the caller was inserted blindly. A caller
 * at property A could insert a room pointing at property B's room type
 * (cross-tenant link the DB FK alone does not block).
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';
const ROOM_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const RT_OLD = 'cccccccc-0000-4000-a000-000000000001';
const RT_NEW = 'dddddddd-0000-4000-a000-000000000001';

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

describe('RoomService — createRoom cross-tenant FK ownership (audit #5)', () => {
  it('rejects when dto.roomTypeId belongs to another property', async () => {
    const db = {
      // FK check returns [] → foreign room type.
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    await expect(
      svc.createRoom({ propertyId: A, roomTypeId: 'foreign-rt', roomNumber: '101' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('allows when dto.roomTypeId is same-property (insert runs)', async () => {
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'rt-1' }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'room-1' }]) }),
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    const out = await svc.createRoom({ propertyId: A, roomTypeId: 'rt-1', roomNumber: '101' } as any);
    expect(out).toEqual({ id: 'room-1' });
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('RoomService — updateRoom roomTypeId move', () => {
  const vacantRoom = {
    id: ROOM_ID,
    propertyId: A,
    roomTypeId: RT_OLD,
    number: '101',
    status: 'vacant_clean',
  };

  it('rejects cross-tenant target room type (404)', async () => {
    const db: any = {
      select: selectQueue([[vacantRoom], []]),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    await expect(
      svc.updateRoom(ROOM_ID, A, { roomTypeId: 'foreign-rt' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects move while room status is occupied', async () => {
    const occupied = { ...vacantRoom, status: 'occupied' };
    const db: any = {
      select: selectQueue([[occupied], [{ id: RT_NEW }]]),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    await expect(
      svc.updateRoom(ROOM_ID, A, { roomTypeId: RT_NEW } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects move while an assigned/in-house reservation links the room', async () => {
    const db: any = {
      select: selectQueue([[vacantRoom], [{ id: RT_NEW }], [{ id: 'res-1' }]]),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    await expect(
      svc.updateRoom(ROOM_ID, A, { roomTypeId: RT_NEW } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows same-property move when vacant and unlinked', async () => {
    const updated = { ...vacantRoom, roomTypeId: RT_NEW };
    const db: any = {
      select: selectQueue([[vacantRoom], [{ id: RT_NEW }], []]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    const out = await svc.updateRoom(ROOM_ID, A, { roomTypeId: RT_NEW } as any);
    expect(out.roomTypeId).toBe(RT_NEW);
    expect(db.update).toHaveBeenCalled();
  });

  it('skips move guards when roomTypeId is unchanged', async () => {
    const db: any = {
      select: selectQueue([[vacantRoom]]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...vacantRoom, floor: '2' }]),
          }),
        }),
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    const out = await svc.updateRoom(ROOM_ID, A, { roomTypeId: RT_OLD, floor: '2' } as any);
    expect(out.floor).toBe('2');
    expect(db.update).toHaveBeenCalled();
  });
});
