import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HousekeepingService } from './housekeeping.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';

/**
 * Cross-tenant FK ownership for HousekeepingService.create (security audit #6).
 * Before the fix: dto.roomId from the caller was used to create a task and
 * generate a checklist without first verifying the room belongs to dto.propertyId.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('HousekeepingService — create cross-tenant FK ownership (audit #6)', () => {
  it('rejects when dto.roomId belongs to another property', async () => {
    const db: any = {
      // FK check on rooms → [] (foreign room).
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        HousekeepingService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: RoomStatusService, useValue: {} },
      ],
    }).compile();
    const svc = mod.get(HousekeepingService);

    await expect(
      svc.create({
        propertyId: A,
        roomId: 'foreign-room',
        type: 'checkout',
        serviceDate: '2026-07-01',
        checklist: [],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
