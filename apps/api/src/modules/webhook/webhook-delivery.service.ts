import {
  Injectable,
  Inject,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac } from 'crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { webhookDeliveries, agentWebhookSubscriptions } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { assertSafeOutboundUrl } from '../../common/security/url-guard';

const WEBHOOK_DELIVERY_QUEUE_NAME = 'haip:webhook-deliveries';
const WEBHOOK_DELIVERY_JOB_NAME = 'deliver-webhook';
const MAX_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 30 * 1000;

// HTTP timeout per delivery.
const REQUEST_TIMEOUT_MS = 5000;

export interface DeliveryPayload {
  eventType: string;
  propertyId: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Internal (in-process) event emitted when a delivery permanently fails after
 * all retries. Deliberately NOT routed through WebhookService: it must not
 * fan out to external subscribers (their endpoint is the thing that's
 * failing). The field is `eventType`, not `event`, so the wildcard webhook
 * fan-out in ConnectEventsService ignores it.
 */
export const WEBHOOK_DELIVERY_FAILED = 'webhook.delivery_failed';

export interface WebhookDeliveryFailedEvent {
  propertyId: string;
  subscriptionId: string;
  subscriberName: string | null;
  deliveryId: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
}

interface WebhookDeliveryJob {
  deliveryId: string;
  propertyId: string;
}

type DeliveryAttemptOutcome = 'delivered' | 'retry' | 'failed' | 'skipped';

interface WebhookDeliveryQueue {
  add(name: string, data: WebhookDeliveryJob, options?: JobsOptions): Promise<unknown>;
  close?(): Promise<void>;
}

interface WebhookDeliveryWorker {
  close(): Promise<void>;
}

/**
 * WebhookDeliveryService — delivers events to subscribers with HMAC signing and retry.
 *
 * BullMQ stores retry jobs in Redis so pending deliveries survive API process
 * restarts. The webhook_deliveries table remains the observability source.
 */
@Injectable()
export class WebhookDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly defaultJobOptions: JobsOptions = {
    attempts: MAX_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: INITIAL_RETRY_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
  private ownsQueue = false;
  private ownsWorker = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private queue?: WebhookDeliveryQueue,
    @Optional() private worker?: WebhookDeliveryWorker,
  ) {}

  onModuleInit() {
    // Unit tests inject a fake queue or call processDeliveryJob directly.
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

  /**
   * Enqueue deliveries for an event — one row per matching subscription,
   * then add a durable BullMQ job for the worker.
   */
  async enqueue(payload: DeliveryPayload, subscriptionId: string) {
    const [delivery] = await this.db
      .insert(webhookDeliveries)
      .values({
        propertyId: payload.propertyId,
        subscriptionId,
        eventType: payload.eventType,
        payload,
        status: 'pending',
        attempts: 0,
      })
      .returning();

    await this.enqueueDeliveryJob(delivery.id, payload.propertyId);

    return delivery;
  }

  async processDeliveryJob(job: WebhookDeliveryJob): Promise<void> {
    const outcome = await this.attemptDelivery(job.deliveryId, job.propertyId);
    if (outcome === 'retry') {
      throw new Error(`Webhook delivery ${job.deliveryId} scheduled for retry`);
    }
  }

  /**
   * Attempt a single delivery. Loads the row, signs the payload, POSTs,
   * and records success or schedules the next retry.
   */
  async attemptDelivery(
    deliveryId: string,
    propertyId: string,
  ): Promise<DeliveryAttemptOutcome> {
    const [delivery] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.propertyId, propertyId),
        ),
      );

    if (!delivery || delivery.status !== 'pending') return 'skipped';

    const [subscription] = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(
        and(
          eq(agentWebhookSubscriptions.id, delivery.subscriptionId),
          eq(agentWebhookSubscriptions.propertyId, propertyId),
        ),
      );

    if (!subscription || !subscription.isActive) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: 'failed',
          lastError: 'Subscription inactive or missing',
          lastAttemptAt: new Date(),
        })
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.propertyId, propertyId),
          ),
        );
      return 'failed';
    }

    const attemptNumber = delivery.attempts + 1;
    const body = JSON.stringify(delivery.payload);
    const signature = subscription.secret
      ? `sha256=${createHmac('sha256', subscription.secret).update(body).digest('hex')}`
      : 'unsigned';

    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    let ok = false;

    try {
      // SSRF guard: re-validate the callback URL (incl. DNS resolution) right
      // before the request so a stored or rebinding URL can't reach internal
      // addresses (metadata, localhost, RFC1918).
      await assertSafeOutboundUrl(subscription.callbackUrl, { requireHttps: true });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(subscription.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-HAIP-Signature': signature,
            'X-HAIP-Event-Id': delivery.id,
            'X-HAIP-Event-Type': delivery.eventType,
          },
          body,
          // The pre-flight assertSafeOutboundUrl only validates the FIRST URL.
          // Without this, a 302 to http://169.254.169.254/… would be followed to
          // an internal host, defeating the SSRF guard.
          redirect: 'manual',
          signal: controller.signal,
        });
        statusCode = resp.status;
        ok = resp.ok;
        if (!ok) errorMessage = `HTTP ${resp.status}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      errorMessage = err?.message ?? 'Network error';
    }

    const now = new Date();
    if (ok) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: 'delivered',
          attempts: attemptNumber,
          lastAttemptAt: now,
          deliveredAt: now,
          lastStatusCode: statusCode,
          lastError: null,
          nextRetryAt: null,
        })
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.propertyId, propertyId),
          ),
        );

      await this.db
        .update(agentWebhookSubscriptions)
        .set({
          lastDeliveryAt: now,
          lastDeliveryStatus: 'delivered',
          updatedAt: now,
        })
        .where(
          and(
            eq(agentWebhookSubscriptions.id, subscription.id),
            eq(agentWebhookSubscriptions.propertyId, propertyId),
          ),
        );
      return 'delivered';
    }

    // Failure — schedule retry or mark failed.
    if (attemptNumber >= MAX_ATTEMPTS) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: 'failed',
          attempts: attemptNumber,
          lastAttemptAt: now,
          lastStatusCode: statusCode,
          lastError: errorMessage,
          nextRetryAt: null,
        })
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.propertyId, propertyId),
          ),
        );

      await this.db
        .update(agentWebhookSubscriptions)
        .set({
          lastDeliveryAt: now,
          lastDeliveryStatus: 'failed',
          failureCount: (subscription.failureCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentWebhookSubscriptions.id, subscription.id),
            eq(agentWebhookSubscriptions.propertyId, propertyId),
          ),
        );

      this.logger.warn(
        `Webhook delivery ${deliveryId} FAILED after ${attemptNumber} attempts: ${errorMessage}`,
      );

      // Alert staff — mandatory-delivery subscribers (e.g. government
      // reporting integrations) must not fail silently.
      this.eventEmitter?.emit(WEBHOOK_DELIVERY_FAILED, {
        propertyId: delivery.propertyId,
        subscriptionId: subscription.id,
        subscriberName: subscription.subscriberName ?? null,
        deliveryId,
        eventType: delivery.eventType,
        attempts: attemptNumber,
        lastError: errorMessage,
      } satisfies WebhookDeliveryFailedEvent);
      return 'failed';
    }

    const delayMs = this.getRetryDelayMs(attemptNumber);
    await this.db
      .update(webhookDeliveries)
      .set({
        status: 'pending',
        attempts: attemptNumber,
        lastAttemptAt: now,
        lastStatusCode: statusCode,
        lastError: errorMessage,
        nextRetryAt: new Date(now.getTime() + delayMs),
      })
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.propertyId, propertyId),
        ),
      );
    return 'retry';
  }

  /**
   * List deliveries for a subscription (scoped by propertyId).
   */
  async listDeliveries(subscriptionId: string, propertyId: string, limit = 50) {
    return this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.subscriptionId, subscriptionId),
          eq(webhookDeliveries.propertyId, propertyId),
        ),
      )
      .limit(limit);
  }

  private async enqueueDeliveryJob(deliveryId: string, propertyId: string) {
    await this.getQueue().add(
      WEBHOOK_DELIVERY_JOB_NAME,
      { deliveryId, propertyId },
      {
        ...this.defaultJobOptions,
        jobId: deliveryId,
      },
    );
  }

  private getQueue(): WebhookDeliveryQueue {
    if (!this.queue) {
      this.queue = new Queue<WebhookDeliveryJob>(WEBHOOK_DELIVERY_QUEUE_NAME, {
        connection: this.createRedisConnectionOptions(),
      });
      this.ownsQueue = true;
    }
    return this.queue;
  }

  private getWorker(): WebhookDeliveryWorker {
    if (!this.worker) {
      const worker = new Worker<WebhookDeliveryJob>(
        WEBHOOK_DELIVERY_QUEUE_NAME,
        async (job) => this.processDeliveryJob(job.data),
        { connection: this.createRedisConnectionOptions() },
      );
      worker.on('error', (err) => {
        this.logger.error(`Webhook delivery worker error: ${err?.message ?? err}`);
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

  private getRetryDelayMs(failedAttemptNumber: number): number {
    return INITIAL_RETRY_DELAY_MS * 2 ** (failedAttemptNumber - 1);
  }
}
