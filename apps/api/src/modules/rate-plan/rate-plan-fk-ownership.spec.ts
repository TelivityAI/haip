import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RatePlanService } from './rate-plan.service';
import { DRIZZLE } from '../../database/database.module';

const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('RatePlanService — cross-tenant FK ownership', () => {
  it('rejects when dto.roomTypeId belongs to another property', async () => {
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }), // foreign
      }),
      insert: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [RatePlanService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    const svc = mod.get(RatePlanService);

    await expect(
      svc.create({
        propertyId: A,
        roomTypeId: 'foreign-rt',
        name: 'BAR',
        type: 'standard',
        baseAmount: '100.00',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
