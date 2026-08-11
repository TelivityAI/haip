import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationStepProcessorService } from './migration-step-processor.service';

describe('MigrationStepProcessorService', () => {
  let db: any;
  let importService: any;
  let reservationImportService: any;
  let legacyIdMap: any;
  let svc: MigrationStepProcessorService;

  const baseJob = {
    id: 'job-1',
    propertyId: 'prop-1',
    projectId: 'proj-1',
    entity: 'guests',
    status: 'pending',
    dryRun: false,
    payload: { rows: [{ firstName: 'Ada', lastName: 'Lovelace', legacyId: 'G-1' }] },
    checkpointCursor: 0,
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    attempts: 0,
  };

  beforeEach(() => {
    let jobState = { ...baseJob };
    db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([jobState])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: any) => {
          jobState = { ...jobState, ...vals };
          return {
            where: vi.fn(() => Promise.resolve()),
          };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        })),
      })),
      _job: () => jobState,
    };

    importService = {
      run: vi.fn().mockResolvedValue({
        results: [{ index: 0, success: true, id: 'guest-uuid' }],
      }),
    };
    reservationImportService = { importReservations: vi.fn() };
    legacyIdMap = {
      lookup: vi.fn().mockResolvedValue(null),
      record: vi.fn().mockResolvedValue(undefined),
    };

    svc = new MigrationStepProcessorService(
      db,
      importService,
      reservationImportService,
      legacyIdMap,
    );
  });

  it('processes import rows from checkpoint and records legacy id map', async () => {
    const outcome = await svc.processJob('job-1', 'prop-1');

    expect(outcome).toBe('completed');
    expect(importService.run).toHaveBeenCalledWith(
      'prop-1',
      'guests',
      expect.objectContaining({ projectId: 'proj-1', dryRun: false }),
    );
    expect(legacyIdMap.record).toHaveBeenCalledWith(
      'prop-1',
      'proj-1',
      'guests',
      'G-1',
      'guest-uuid',
    );
  });

  it('skips rows already mapped in legacy id map', async () => {
    legacyIdMap.lookup.mockResolvedValue('existing-uuid');

    await svc.processJob('job-1', 'prop-1');

    expect(importService.run).not.toHaveBeenCalled();
  });

  it('resumes from checkpoint without re-processing earlier rows', async () => {
    db.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Promise.resolve([
            {
              ...baseJob,
              checkpointCursor: 1,
              processedRows: 1,
              payload: {
                rows: [
                  { firstName: 'Ada', lastName: 'Lovelace' },
                  { firstName: 'Grace', lastName: 'Hopper', legacyId: 'G-2' },
                ],
              },
            },
          ]),
        ),
      })),
    }));

    await svc.processJob('job-1', 'prop-1');

    expect(importService.run).toHaveBeenCalledTimes(1);
    expect(importService.run).toHaveBeenCalledWith(
      'prop-1',
      'guests',
      expect.objectContaining({ rows: [expect.objectContaining({ firstName: 'Grace' })] }),
    );
  });
});
