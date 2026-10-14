import {
  Injectable,
  Inject,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

/**
 * The payment service method the worker calls when a bank challenge expires.
 * A token is used so this file does not import PaymentService. That import
 * cycle crashes the compiled API before it can listen.
 */
export interface WorldlineChallengeExpirer {
  expireWorldlineChallenge(paymentId: string, propertyId: string): Promise<void>;
}

export const WORLDLINE_CHALLENGE_EXPIRER = Symbol('WORLDLINE_CHALLENGE_EXPIRER');

export const WORLDLINE_CHALLENGE_QUEUE_NAME = 'haip-worldline-challenges';
export const WORLDLINE_CHALLENGE_JOB_NAME = 'expire-worldline-challenge';
/** A guest who closes the bank page is finished after this delay. */
export const WORLDLINE_CHALLENGE_DELAY_MS = 30 * 60 * 1000;
/** A thrown status read retries. It does not cancel the booking. */
export const WORLDLINE_CHALLENGE_ATTEMPTS = 5;
export const WORLDLINE_CHALLENGE_BACKOFF_MS = 30_000;

export interface WorldlineChallengeJob {
  paymentId: string;
  propertyId: string;
}

const WORLDLINE_CHALLENGE_QUEUE = Symbol('WORLDLINE_CHALLENGE_QUEUE');
const WORLDLINE_CHALLENGE_WORKER = Symbol('WORLDLINE_CHALLENGE_WORKER');

type ChallengeQueue = {
  add: Queue<WorldlineChallengeJob>['add'];
  close?: Queue<WorldlineChallengeJob>['close'];
};

type ChallengeWorker = {
  close: Worker<WorldlineChallengeJob>['close'];
};

/**
 * Delayed check for a Worldline bank challenge. Tests inject the queue and
 * do not open Redis. The worker uses the same Redis URL as webhook delivery.
 */
@Injectable()
export class WorldlineChallengeQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldlineChallengeQueue.name);
  private ownsQueue = false;
  private ownsWorker = false;

  constructor(
    @Optional() @Inject(WORLDLINE_CHALLENGE_EXPIRER)
    private readonly payments?: WorldlineChallengeExpirer,
    @Optional() @Inject(WORLDLINE_CHALLENGE_QUEUE)
    private queue?: ChallengeQueue,
    @Optional() @Inject(WORLDLINE_CHALLENGE_WORKER)
    private worker?: ChallengeWorker,
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

  async schedule(paymentId: string, propertyId: string): Promise<void> {
    await this.getQueue().add(
      WORLDLINE_CHALLENGE_JOB_NAME,
      { paymentId, propertyId },
      {
        delay: WORLDLINE_CHALLENGE_DELAY_MS,
        jobId: `worldline-challenge-${paymentId}`,
        removeOnComplete: true,
        attempts: WORLDLINE_CHALLENGE_ATTEMPTS,
        backoff: { type: 'exponential', delay: WORLDLINE_CHALLENGE_BACKOFF_MS },
      },
    );
  }

  private getQueue(): ChallengeQueue {
    if (!this.queue) {
      this.queue = new Queue<WorldlineChallengeJob>(WORLDLINE_CHALLENGE_QUEUE_NAME, {
        connection: redisConnectionOptions(),
      });
      this.ownsQueue = true;
    }
    return this.queue;
  }

  private getWorker(): ChallengeWorker {
    if (!this.worker) {
      const worker = new Worker<WorldlineChallengeJob>(
        WORLDLINE_CHALLENGE_QUEUE_NAME,
        async (job) => {
          await this.payments?.expireWorldlineChallenge(job.data.paymentId, job.data.propertyId);
        },
        { connection: redisConnectionOptions() },
      );
      worker.on('error', (err) => {
        this.logger.error(`Worldline challenge worker error: ${err?.message ?? err}`);
      });
      this.worker = worker;
      this.ownsWorker = true;
    }
    return this.worker;
  }
}

function redisConnectionOptions() {
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
