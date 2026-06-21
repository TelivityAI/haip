import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RoomingListService } from './rooming-list.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { ReservationService } from '../reservation/reservation.service';
import { AllotmentService } from './allotment.service';
import { GroupProfileService } from './group-profile.service';

/**
 * Cross-tenant FK ownership for RoomingListService.importRoomingList — flagged by
 * the security re-audit. A caller-supplied entry.roomTypeId could insert a
 * cross-property FK into rooming_list_entries. The fix records the entry as an
 * error and continues the batch (matches existing per-row error handling).
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('RoomingListService — cross-tenant entry.roomTypeId', () => {
  it('does NOT insert when entry.roomTypeId belongs to another property — records as error', async () => {
    // FK check returns [] (foreign), then we never proceed to insert this row.
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        RoomingListService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: ReservationService, useValue: {} },
        { provide: AllotmentService, useValue: {
          findBlockById: vi.fn().mockResolvedValue({ id: 'blk-1', startDate: '2026-07-01', endDate: '2026-07-05' }),
        } },
        { provide: GroupProfileService, useValue: {} },
      ],
    }).compile();
    const svc = mod.get(RoomingListService);

    const out = await svc.importRoomingList('blk-1', A, {
      entries: [
        { guestName: 'Foreign Tenant', roomTypeId: 'foreign-rt' } as any,
      ],
    } as any);

    expect(db.insert).not.toHaveBeenCalled();
    // The bad entry is surfaced as an error in the per-row results — the batch
    // is not aborted (matches existing rooming-list error semantics).
    expect(out.errors).toBe(1);
    expect(out.results[0].status).toBe('error');
    expect(String(out.results[0].error)).toContain('foreign-rt');
  });
});
