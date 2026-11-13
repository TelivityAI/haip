import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NightAuditSchedulerService } from './night-audit-scheduler.service';
import { NightAuditService } from './night-audit.service';
import { AllotmentService } from '../groups/allotment.service';
import { DRIZZLE } from '../../database/database.module';

function scriptedDb(queues: unknown[][]) {
  let n = 0;
  const take = () => queues[n++] ?? [];
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const rows = take();
          const promise = Promise.resolve(rows);
          return {
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() => Promise.resolve(rows)),
            }),
            then: promise.then.bind(promise),
          };
        }),
      }),
    })),
  };
}

describe('NightAuditSchedulerService', () => {
  it('closes each hotel on its own clock and isolates a failure', async () => {
    const db = scriptedDb([
      [
        {
          id: 'paris',
          timezone: 'Europe/Paris',
          settings: { nightAudit: { autoCloseHour: 2 } },
        },
        {
          id: 'broken',
          timezone: 'Not/AZone',
          settings: {},
        },
        {
          id: 'early',
          timezone: 'America/Los_Angeles',
          settings: { nightAudit: { autoCloseHour: 2 } },
        },
      ],
      [{ businessDate: '2026-06-01' }],
      [{ businessDate: '2026-06-01' }],
    ]);
    const runAudit = vi.fn().mockResolvedValue({ alreadyRun: false, auditRun: { id: 'run' } });
    const processCutoffs = vi.fn().mockResolvedValue({ released: 0 });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditSchedulerService,
        { provide: DRIZZLE, useValue: db },
        { provide: NightAuditService, useValue: { runAudit } },
        { provide: AllotmentService, useValue: { processCutoffs } },
      ],
    }).compile();
    const svc = module.get(NightAuditSchedulerService);

    const result = await svc.runDue({ now: new Date('2026-06-02T08:30:00Z') });

    expect(runAudit).toHaveBeenCalledTimes(0);
    expect(result.skippedBeforeCutoff).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ propertyId: 'broken', error: 'invalid_timezone' }),
    ]);
    expect(result.closedProperties).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.totalProperties).toBe(3);
    expect(processCutoffs).toHaveBeenCalledWith('paris');
  });

  it('stops a hotel on the first failed date and still closes the other', async () => {
    const db = scriptedDb([
      [
        { id: 'a', timezone: 'UTC', settings: { nightAudit: { autoCloseHour: 0 } } },
        { id: 'b', timezone: 'UTC', settings: { nightAudit: { autoCloseHour: 0 } } },
      ],
      [],
      [],
      [{ businessDate: '2026-06-01' }],
    ]);
    const runAudit = vi.fn(async (dto: { propertyId: string }) => {
      if (dto.propertyId === 'a') throw new Error('folio locked');
      return { alreadyRun: false };
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditSchedulerService,
        { provide: DRIZZLE, useValue: db },
        { provide: NightAuditService, useValue: { runAudit } },
        { provide: AllotmentService, useValue: { processCutoffs: vi.fn().mockResolvedValue({ released: 1 }) } },
      ],
    }).compile();
    const svc = module.get(NightAuditSchedulerService);
    const result = await svc.runDue({
      now: new Date('2026-06-02T03:00:00Z'),
      forceWindow: true,
    });
    expect(result.failures[0]).toMatchObject({ propertyId: 'a', error: 'folio locked' });
    expect(result.closedProperties).toBe(1);
    expect(runAudit).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'b',
      mode: 'unattended',
      businessDate: '2026-06-01',
    }));
  });
});
