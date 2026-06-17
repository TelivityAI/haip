import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentController } from './agent.controller';
import { DRIZZLE } from '../../database/database.module';
import { AgentService } from './agent.service';

/**
 * Cross-tenant FK ownership for AgentController.createReview — flagged by the
 * security re-audit. A caller-supplied dto.reservationId could be inserted into
 * guest_reviews even when it belongs to another property.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('AgentController — createReview cross-tenant reservationId', () => {
  it('rejects when dto.reservationId belongs to another property', async () => {
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      insert: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        { provide: DRIZZLE, useValue: db },
        { provide: AgentService, useValue: { runAgent: vi.fn() } },
      ],
    }).compile();
    const ctrl = mod.get(AgentController);

    await expect(
      ctrl.createReview(A, {
        source: 'tripadvisor',
        guestName: 'Anon',
        rating: 5,
        reviewText: 'great',
        reservationId: 'foreign-r',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
