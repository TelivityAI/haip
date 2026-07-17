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
import { eq, and, lte, or, isNull } from 'drizzle-orm';
import { webhookDeliveries, agentWebhookSubscriptions } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { assertSafeOutboundUrl } from '../../common/security/url-guard';

// Exponential backoff schedule in milliseconds: 30s, 2m, 10m, 1h, 6h.
const RETRY_SCHEDULE_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];
const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length;

// Interval for scanning pending retries. Disabled in tests (NODE_ENV=test).
const RETRY_SCAN_INTERVAL_MS = 30 * 1000;

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

/**
 * WebhookDeliveryService — delivers events to subscribers with HMAC signing and retry.
 *
 * Not using BullMQ because Redis isn't wired up. Pragmatic replacement:
 *   - insert one webhook_deliveries row per (event, matching-subscription)
 *   - fire the HTTP POST immediately (fire-and-forget, caught)
 *   - a periodic scan re-tries any still-pending row whose nextRetryAt <= now
 *   - after MAX_ATTEMPTS, mark as 'failed'
 */
@Injectable()
export class WebhookDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  onModuleInit() {
    // Skip the background scanner in tests to keep Vitest fast and deterministic.
    if (process.env['NODE_ENV'] === 'test') return;
    this.scanTimer = setInterval(() => {
      this.processPending().catch((err) =>
        this.logger.error(`Retry scan failed: ${err?.message ?? err}`),
      );
    }, RETRY_SCAN_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  /**
   * Enqueue deliveries for an event — one row per matching subscription,
   * then fire the first attempt asynchronously.
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

    // Fire the first attempt without awaiting (tests can await via attemptDelivery).
    this.attemptDelivery(delivery.id).catch((err) =>
      this.logger.error(`Delivery ${delivery.id} failed unexpectedly: ${err?.message ?? err}`),
    );

    return delivery;
  }

  /**
   * Attempt a single delivery. Loads the row, signs the payload, POSTs,
   * and records success or schedules the next retry.
   */
  async attemptDelivery(deliveryId: string): Promise<void> {
    const [delivery] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));

    if (!delivery || delivery.status !== 'pending') return;

    const [subscription] = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(eq(agentWebhookSubscriptions.id, delivery.subscriptionId));

    if (!subscription || !subscription.isActive) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: 'failed',
          lastError: 'Subscription inactive or missing',
          lastAttemptAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      return;
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
        .where(eq(webhookDeliveries.id, deliveryId));

      await this.db
        .update(agentWebhookSubscriptions)
        .set({
          lastDeliveryAt: now,
          lastDeliveryStatus: 'delivered',
          updatedAt: now,
        })
        .where(eq(agentWebhookSubscriptions.id, subscription.id));
      return;
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
        .where(eq(webhookDeliveries.id, deliveryId));

      await this.db
        .update(agentWebhookSubscriptions)
        .set({
          lastDeliveryAt: now,
          lastDeliveryStatus: 'failed',
          failureCount: (subscription.failureCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(agentWebhookSubscriptions.id, subscription.id));

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
      return;
    }

    const delayMs = RETRY_SCHEDULE_MS[attemptNumber] ?? RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]!;
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
      .where(eq(webhookDeliveries.id, deliveryId));
  }

  /**
   * Scan for pending deliveries whose nextRetryAt <= now and re-attempt them.
   * Runs on an interval. Also handles never-attempted rows (nextRetryAt IS NULL).
   */
  async processPending(): Promise<number> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, 'pending'),
          or(
            isNull(webhookDeliveries.nextRetryAt),
            lte(webhookDeliveries.nextRetryAt, now),
          ),
        ),
      );

    for (const row of rows) {
      await this.attemptDelivery(row.id);
    }
    return rows.length;
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
}
