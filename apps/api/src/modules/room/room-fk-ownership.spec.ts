import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
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
