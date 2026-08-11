import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { MigrationService } from './migration.service';

const QUEUE_NAME = 'haip-migration-jobs';
const JOB_NAME = 'process-migration-job';
const MAX_ATTEMPTS = 4;

interface MigrationJobPayload {
  jobId: string;
  propertyId: string;
}

interface MigrationQueue {
  add(name: string, data: MigrationJobPayload, options?: JobsOptions): Promise<unknown>;
  close?(): Promise<void>;
}

interface MigrationWorker {
  close(): Promise<void>;
}

/**
 * BullMQ runner for migration jobs (TEL-67). Mirrors the webhook-delivery
 * pattern: Redis-backed queue survives API restarts; on failure the job row
 * stays `pending` at its checkpoint and the retry resumes from it. Unit tests
 * inject a fake queue or call MigrationService.processJob directly.
 */
@Injectable()
export class MigrationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MigrationQueueService.name);
  private readonly defaultJobOptions: JobsOptions = {
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: true,
    removeOnFail: false,
  };
  private ownsQueue = false;
  private ownsWorker = false;

  constructor(
    private readonly migrationService: MigrationService,
    @Optional() private queue?: MigrationQueue,
    @Optional() private worker?: MigrationWorker,
  ) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.getQueue();
    this.getWorker();
  }

  async onModuleDestroy() {
    if (this.ownsWorker && this.worker) await this.worker.close();
    if (this.ownsQueue && this.queue?.close) await this.queue.close();
  }

  async enqueue(jobId: string, propertyId: string) {
    await this.getQueue().add(JOB_NAME, { jobId, propertyId }, this.defaultJobOptions);
  }

  private getQueue(): MigrationQueue {
    if (!this.queue) {
      this.queue = new Queue<MigrationJobPayload>(QUEUE_NAME, {
        connection: this.redisConnection(),
      });
      this.ownsQueue = true;
    }
    return this.queue;
  }

  private getWorker(): MigrationWorker {
    if (!this.worker) {
      const worker = new Worker<MigrationJobPayload>(
        QUEUE_NAME,
        async (job) => this.migrationService.processJob(job.data.jobId, job.data.propertyId),
        { connection: this.redisConnection() },
      );
      worker.on('error', (err) => {
        this.logger.error(`Migration worker error: ${err?.message ?? err}`);
      });
      this.worker = worker;
      this.ownsWorker = true;
    }
    return this.worker;
  }

  private redisConnection() {
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
