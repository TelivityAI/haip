import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MigrationService } from './migration.service';

describe('MigrationService', () => {
  let db: any;
  let stepProcessor: any;
  let svc: MigrationService;
  const jobs = new Map<string, any>();

  beforeEach(() => {
    jobs.clear();
    let idCounter = 1;
    db = {
      insert: vi.fn(() => ({
        values: vi.fn((vals: any) => ({
          returning: vi.fn(() => {
            const job = { id: `job-${idCounter++}`, ...vals };
            jobs.set(job.id, job);
            return Promise.resolve([job]);
          }),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ id: 'job-1', status: 'pending' }])),
          })),
        })),
      })),
    };
    stepProcessor = { enqueueStep: vi.fn().mockResolvedValue(undefined) };
    svc = new MigrationService(db, stepProcessor);
  });

  it('creates a job and enqueues a step', async () => {
    const job = await svc.createJob('prop-1', {
      projectId: 'proj-1',
      entity: 'guests',
      rows: [{ firstName: 'Ada', lastName: 'Lovelace' }],
    });

    expect(job.entity).toBe('guests');
    expect(stepProcessor.enqueueStep).toHaveBeenCalledWith(job.id, 'prop-1');
  });

  it('rejects unknown entities', async () => {
    await expect(
      svc.createJob('prop-1', { projectId: 'p', entity: 'unknown', rows: [{ a: '1' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
