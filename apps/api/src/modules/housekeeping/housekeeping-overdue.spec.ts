import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { HousekeepingService } from './housekeeping.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';

describe('HousekeepingService overdueTasksCount', () => {
  it('counts open tasks before the property business date', async () => {
    let whereCalls = 0;
    const db: any = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            whereCalls += 1;
            const call = whereCalls;
            const promise = Promise.resolve(
              call === 1 ? [{ timezone: 'Pacific/Auckland' }] : [{ count: 4 }],
            );
            return {
              groupBy: vi.fn().mockReturnValue({ then: (resolve: (rows: unknown[]) => void) => resolve([]) }),
              orderBy: vi.fn().mockReturnValue({ then: (resolve: (rows: unknown[]) => void) => resolve([]) }),
              then: promise.then.bind(promise),
            };
          }),
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                then: (resolve: (rows: unknown[]) => void) => resolve([]),
              }),
            }),
          }),
        }),
      })),
    };
    const module = await Test.createTestingModule({
      providers: [
        HousekeepingService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: RoomStatusService, useValue: { getPropertyRoomSummary: vi.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    const svc = module.get(HousekeepingService);
    const result = await svc.getDashboard('prop-001', '2026-04-06');
    expect(result.overdueTasksCount).toBe(4);
    expect(result.openBusinessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.date).toBe('2026-04-06');
  });
});
