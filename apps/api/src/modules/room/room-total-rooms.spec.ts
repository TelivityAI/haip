import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoomService } from './room.service';
import { DRIZZLE } from '../../database/database.module';

const PROPERTY = 'aaaaaaaa-0000-4000-a000-000000000001';
const ROOM = 'bbbbbbbb-0000-4000-a000-000000000001';

function whereResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    limit: vi.fn().mockResolvedValue(rows),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
}

describe('RoomService totalRooms sync', () => {
  it('recomputes properties.total_rooms after creating a room', async () => {
    const sets: unknown[] = [];
    let selects = 0;
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selects += 1;
            return whereResult(selects === 1 ? [{ id: 'rt-1' }] : [{ count: 12 }]);
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'room-new', number: '101' }]),
        }),
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((value: unknown) => {
          sets.push(value);
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      })),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    const out = await svc.createRoom({
      propertyId: PROPERTY,
      roomTypeId: 'rt-1',
      number: '101',
    } as any);

    expect(out).toEqual({ id: 'room-new', number: '101' });
    expect(sets).toEqual([expect.objectContaining({ totalRooms: 12 })]);
  });

  it('refuses to retire an occupied room', async () => {
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(
            whereResult([
              { id: ROOM, number: '101', status: 'occupied', isActive: true, propertyId: PROPERTY },
            ]),
          ),
        }),
      }),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    await expect(
      svc.updateRoom(ROOM, PROPERTY, { isActive: false } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses to retire a room linked to an in-house stay', async () => {
    const queued = [
      [{ id: ROOM, number: '204', status: 'vacant_clean', isActive: true, propertyId: PROPERTY }],
      [{ id: 'res-1' }],
    ];
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => whereResult(queued.shift() ?? [])),
        }),
      }),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    await expect(
      svc.updateRoom(ROOM, PROPERTY, { isActive: false } as any),
    ).rejects.toThrow(/active stay/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('retires a vacant room and stores the active-room count', async () => {
    const queued = [
      [{ id: ROOM, number: '204', status: 'vacant_clean', isActive: true, propertyId: PROPERTY }],
      [],
      [{ count: 7 }],
    ];
    const sets: unknown[] = [];
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => whereResult(queued.shift() ?? [])),
        }),
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((value: unknown) => {
          sets.push(value);
          const promise = Promise.resolve([{ id: ROOM, number: '204', isActive: false }]);
          return {
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: ROOM, number: '204', isActive: false }]),
              then: promise.then.bind(promise),
            }),
          };
        }),
      })),
    };
    const mod = await Test.createTestingModule({
      providers: [RoomService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RoomService);

    const out = await svc.updateRoom(ROOM, PROPERTY, { isActive: false } as any);
    expect(out.isActive).toBe(false);
    expect(sets.some((value) => (value as { totalRooms?: number }).totalRooms === 7)).toBe(true);
  });
});
