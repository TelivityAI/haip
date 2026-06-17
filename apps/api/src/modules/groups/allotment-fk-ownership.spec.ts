import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllotmentService } from './allotment.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { AvailabilityService } from '../reservation/availability.service';

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
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'blk-1' }]) }),
    }),
  };
}

async function mkSvc(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      AllotmentService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: AvailabilityService, useValue: {} },
    ],
  }).compile();
  return mod.get(AllotmentService);
}

describe('AllotmentService — cross-tenant FK ownership', () => {
  it('rejects when dto.groupProfileId belongs to another property', async () => {
    const db = mkDbSeq([[]]); // group profile FK empty
    const svc = await mkSvc(db);
    await expect(
      svc.createBlock({
        propertyId: A,
        groupProfileId: 'foreign-gp',
        name: 'Block',
        startDate: '2026-07-01',
        endDate: '2026-07-05',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects when dto.ratePlanId belongs to another property (groupProfile OK)', async () => {
    const db = mkDbSeq([
      [{ id: 'gp-1' }], // group profile OK
      [],               // rate plan FK empty
    ]);
    const svc = await mkSvc(db);
    await expect(
      svc.createBlock({
        propertyId: A,
        groupProfileId: 'gp-1',
        ratePlanId: 'foreign-rp',
        name: 'Block',
        startDate: '2026-07-01',
        endDate: '2026-07-05',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
