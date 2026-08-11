import {
  Injectable,
  Inject,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { migrationJobs, migrationRowResults } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ImportService } from '../import/import.service';
import { ReservationImportService } from '../reservation/reservation-import.service';
import { MigrationLegacyIdMapService } from './migration-legacy-id-map.service';

const MIGRATION_STEP_QUEUE_NAME = 'haip-migration-steps';
const MIGRATION_STEP_JOB_NAME = 'process-migration-step';
const MAX_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 30 * 1000;

interface MigrationStepJob {
  jobId: string;
  propertyId: string;
}

type StepOutcome = 'completed' | 'retry' | 'failed' | 'skipped';

interface MigrationStepQueue {
  add(name: string, data: MigrationStepJob, options?: JobsOptions): Promise<unknown>;
  close?(): Promise<void>;
}

interface MigrationStepWorker {
  close(): Promise<void>;
}

/**
 * BullMQ-backed migration step processor. Processes rows from checkpointCursor
 * forward, recording per-row results and updating the legacy id map on success.
 */
@Injectable()
export class MigrationStepProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MigrationStepProcessorService.name);
  private readonly defaultJobOptions: JobsOptions = {
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: INITIAL_RETRY_DELAY_MS },
    removeOnComplete: true,
    removeOnFail: false,
  };
  private ownsQueue = false;
  private ownsWorker = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly importService: ImportService,
    private readonly reservationImportService: ReservationImportService,
    private readonly legacyIdMap: MigrationLegacyIdMapService,
    @Optional() private queue?: MigrationStepQueue,
    @Optional() private worker?: MigrationStepWorker,
  ) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.getQueue();
    this.getWorker();
  }

  async onModuleDestroy() {
    if (this.ownsWorker && this.worker) {
      await this.worker.close();
    }
    if (this.ownsQueue && this.queue?.close) {
      await this.queue.close();
    }
  }

  async enqueueStep(jobId: string, propertyId: string) {
    await this.getQueue().add(
      MIGRATION_STEP_JOB_NAME,
      { jobId, propertyId },
      { ...this.defaultJobOptions, jobId: `migration-${jobId}` },
    );
  }

  async processStepJob(data: MigrationStepJob): Promise<void> {
    const outcome = await this.processJob(data.jobId, data.propertyId);
    if (outcome === 'retry') {
      throw new Error(`Migration job ${data.jobId} scheduled for retry`);
    }
  }

  async processJob(jobId: string, propertyId: string): Promise<StepOutcome> {
    const [job] = await this.db
      .select()
      .from(migrationJobs)
      .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));

    if (!job || job.status === 'completed') return 'skipped';

    const attemptNumber = (job.attempts ?? 0) + 1;
    const now = new Date();

    await this.db
      .update(migrationJobs)
      .set({
        status: 'running',
        attempts: attemptNumber,
        startedAt: job.startedAt ?? now,
        updatedAt: now,
        lastError: null,
      })
      .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));

    try {
      if (job.entity === 'reservations') {
        await this.processReservationRows(job);
      } else {
        await this.processImportRows(job);
      }

      await this.db
        .update(migrationJobs)
        .set({
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          nextRetryAt: null,
        })
        .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));

      return 'completed';
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error';
      if (attemptNumber >= MAX_ATTEMPTS) {
        await this.db
          .update(migrationJobs)
          .set({
            status: 'failed',
            lastError: message,
            updatedAt: now,
            nextRetryAt: null,
          })
          .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
        this.logger.warn(`Migration job ${jobId} FAILED after ${attemptNumber} attempts: ${message}`);
        return 'failed';
      }

      const delayMs = INITIAL_RETRY_DELAY_MS * 2 ** (attemptNumber - 1);
      await this.db
        .update(migrationJobs)
        .set({
          status: 'pending',
          lastError: message,
          updatedAt: now,
          nextRetryAt: new Date(now.getTime() + delayMs),
        })
        .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
      return 'retry';
    }
  }

  private async processImportRows(job: any) {
    const payload = job.payload as { rows?: Record<string, string>[]; mapping?: Record<string, string> };
    const rows = payload.rows ?? [];
    let cursor = job.checkpointCursor ?? 0;
    let processed = job.processedRows ?? 0;
    let succeeded = job.succeededRows ?? 0;
    let failed = job.failedRows ?? 0;

    for (let i = cursor; i < rows.length; i++) {
      const row = rows[i]!;
      const legacyId = row.legacyId?.trim() || undefined;

      if (legacyId) {
        const existing = await this.legacyIdMap.lookup(
          job.propertyId,
          job.projectId,
          job.entity,
          legacyId,
        );
        if (existing) {
          await this.upsertRowResult(job, i, 'skipped', legacyId, existing);
          processed++;
          succeeded++;
          cursor = i + 1;
          continue;
        }
      }

      const result = await this.importService.run(job.propertyId, job.entity, {
        rows: [row],
        mapping: payload.mapping,
        dryRun: job.dryRun,
        projectId: job.projectId,
        legacyIdMap: this.legacyIdMap,
      });

      const rowResult = result.results[0]!;
      if (rowResult.success) {
        if (!job.dryRun && legacyId && rowResult.id) {
          await this.legacyIdMap.record(
            job.propertyId,
            job.projectId,
            job.entity,
            legacyId,
            rowResult.id,
          );
        }
        await this.upsertRowResult(job, i, 'succeeded', legacyId, rowResult.id);
        succeeded++;
      } else {
        await this.upsertRowResult(job, i, 'failed', legacyId, undefined, rowResult.error);
        failed++;
      }
      processed++;
      cursor = i + 1;

      await this.db
        .update(migrationJobs)
        .set({
          checkpointCursor: cursor,
          processedRows: processed,
          succeededRows: succeeded,
          failedRows: failed,
          updatedAt: new Date(),
        })
        .where(and(eq(migrationJobs.id, job.id), eq(migrationJobs.propertyId, job.propertyId)));
    }
  }

  private async processReservationRows(job: any) {
    const payload = job.payload as { reservations?: Record<string, unknown>[] };
    const rows = payload.reservations ?? [];
    let cursor = job.checkpointCursor ?? 0;
    let processed = job.processedRows ?? 0;
    let succeeded = job.succeededRows ?? 0;
    let failed = job.failedRows ?? 0;

    for (let i = cursor; i < rows.length; i++) {
      const result = await this.reservationImportService.importReservations(job.propertyId, {
        propertyId: job.propertyId,
        projectId: job.projectId,
        dryRun: job.dryRun,
        rows: [rows[i] as any],
      });

      const rowResult = result.results[0]!;
      const legacyId = (rows[i] as any)?.legacyId as string | undefined;

      if (rowResult.success) {
        await this.upsertRowResult(
          job,
          i,
          rowResult.skipped ? 'skipped' : 'succeeded',
          legacyId,
          rowResult.reservationId,
        );
        succeeded++;
      } else {
        await this.upsertRowResult(job, i, 'failed', legacyId, undefined, rowResult.error);
        failed++;
      }
      processed++;
      cursor = i + 1;

      await this.db
        .update(migrationJobs)
        .set({
          checkpointCursor: cursor,
          processedRows: processed,
          succeededRows: succeeded,
          failedRows: failed,
          updatedAt: new Date(),
        })
        .where(and(eq(migrationJobs.id, job.id), eq(migrationJobs.propertyId, job.propertyId)));
    }
  }

  private async upsertRowResult(
    job: any,
    rowIndex: number,
    status: 'succeeded' | 'failed' | 'skipped',
    legacyId?: string,
    haipId?: string,
    error?: string,
  ) {
    const now = new Date();
    await this.db
      .insert(migrationRowResults)
      .values({
        jobId: job.id,
        propertyId: job.propertyId,
        rowIndex,
        status,
        legacyId: legacyId ?? null,
        haipId: haipId ?? null,
        error: error ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [migrationRowResults.jobId, migrationRowResults.rowIndex],
        set: {
          status,
          legacyId: legacyId ?? null,
          haipId: haipId ?? null,
          error: error ?? null,
          updatedAt: now,
        },
      });
  }

  private getQueue(): MigrationStepQueue {
    if (!this.queue) {
      this.queue = new Queue<MigrationStepJob>(MIGRATION_STEP_QUEUE_NAME, {
        connection: this.createRedisConnectionOptions(),
      });
      this.ownsQueue = true;
    }
    return this.queue;
  }

  private getWorker(): MigrationStepWorker {
    if (!this.worker) {
      const worker = new Worker<MigrationStepJob>(
        MIGRATION_STEP_QUEUE_NAME,
        async (bullJob) => this.processStepJob(bullJob.data),
        { connection: this.createRedisConnectionOptions() },
      );
      worker.on('error', (err) => {
        this.logger.error(`Migration step worker error: ${err?.message ?? err}`);
      });
      this.worker = worker;
      this.ownsWorker = true;
    }
    return this.worker;
  }

  private createRedisConnectionOptions() {
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    const parsed = new URL(redisUrl);
    const dbPath = parsed.pathname.replace(/^\//, '');
    const db = dbPath ? Number(dbPath) : undefined;
    if (db !== undefined && Number.isNaN(db)) {
      throw new Error(`Invalid REDIS_URL database index: ${dbPath}`);
    }

    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      db,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }
}
