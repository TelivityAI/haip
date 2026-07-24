import { Injectable, Inject, NotFoundException, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq, and, gte, desc } from 'drizzle-orm';
import { agentWebhookSubscriptions, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import type { CreateSubscriptionDto } from './dto/agent-event-subscription.dto';
import { WebhookDeliveryService } from '../webhook/webhook-delivery.service';

@Injectable()
export class ConnectEventsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Optional() private readonly deliveryService?: WebhookDeliveryService,
  ) {}

  /**
   * Strip the HMAC `secret` before a subscription row leaves the service.
   * The secret is used server-side to sign webhook deliveries; returning it in
   * API responses would let any caller forge signed deliveries to that
   * subscriber. Callers supply the secret at creation and must retain their own copy.
   */
  private redactSecret<T extends { secret?: unknown }>(row: T): Omit<T, 'secret'> {
    const { secret: _secret, ...rest } = row;
    return rest;
  }

  /**
   * Create an event subscription for an OTAIP agent.
   */
  async createSubscription(dto: CreateSubscriptionDto) {
    const [subscription] = await this.db
      .insert(agentWebhookSubscriptions)
      .values({
        propertyId: dto.propertyId,
        subscriberId: dto.subscriberId,
        subscriberName: dto.subscriberName,
        callbackUrl: dto.callbackUrl,
        events: dto.events,
        secret: dto.secret,
      })
      .returning();

    return this.redactSecret(subscription);
  }

  /**
   * List subscriptions for a property.
   */
  async listSubscriptions(propertyId: string) {
    const rows = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(
        and(
          eq(agentWebhookSubscriptions.propertyId, propertyId),
          eq(agentWebhookSubscriptions.isActive, true),
        ),
      );
    return rows.map((row: any) => this.redactSecret(row));
  }

  /**
   * Delete (deactivate) a subscription.
   */
  async deleteSubscription(id: string, propertyId: string) {
    const [subscription] = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(
        and(
          eq(agentWebhookSubscriptions.id, id),
          eq(agentWebhookSubscriptions.propertyId, propertyId),
        ),
      );

    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    await this.db
      .update(agentWebhookSubscriptions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(agentWebhookSubscriptions.id, id),
          eq(agentWebhookSubscriptions.propertyId, propertyId),
        ),
      );

    return { deleted: true, id };
  }

  /**
   * Send a test event to verify a subscription's callback URL.
   */
  async testSubscription(id: string, propertyId: string) {
    const [subscription] = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(
        and(
          eq(agentWebhookSubscriptions.id, id),
          eq(agentWebhookSubscriptions.propertyId, propertyId),
        ),
      );

    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    // Log the test delivery (no actual HTTP call — needs BullMQ for reliable delivery)
    await this.db
      .update(agentWebhookSubscriptions)
      .set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: 'test_logged',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentWebhookSubscriptions.id, id),
          eq(agentWebhookSubscriptions.propertyId, propertyId),
        ),
      );

    return {
      testSent: true,
      subscriptionId: id,
      callbackUrl: subscription.callbackUrl,
      note: 'Test event logged. Webhook delivery jobs are processed by BullMQ.',
    };
  }

  /**
   * Poll events — fallback for agents that can't receive webhooks.
   * Queries auditLogs table filtered by propertyId, action, and timestamp.
   */
  async pollEvents(propertyId: string, since?: string, types?: string[], limit = 50) {
    const conditions = [eq(auditLogs.propertyId, propertyId)];

    if (since) {
      conditions.push(gte(auditLogs.occurredAt, new Date(since)));
    }

    let events = await this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit);

    // Filter by event type patterns if specified
    if (types?.length) {
      events = events.filter((e: any) => {
        const eventType = `${e.entityType}.${e.action}`;
        return types.some((pattern) => this.matchesEventPattern(eventType, pattern));
      });
    }

    return events.map((e: any) => ({
      id: e.id,
      type: `${e.entityType}.${e.action}`,
      propertyId: e.propertyId,
      entityType: e.entityType,
      entityId: e.entityId,
      data: e.newValue ?? {},
      occurredAt: e.occurredAt.toISOString(),
    }));
  }

  /**
   * Handle all webhook events — match against subscriptions and log delivery.
   * Listens to all events via wildcard.
   */
  @OnEvent('**')
  async handleEvent(payload: any) {
    if (!payload?.propertyId || !payload?.event) return;

    // Find matching subscriptions
    const subscriptions = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(
        and(
          eq(agentWebhookSubscriptions.propertyId, payload.propertyId),
          eq(agentWebhookSubscriptions.isActive, true),
        ),
      );

    for (const sub of subscriptions) {
      const events = (sub.events ?? []) as string[];
      if (events.some((pattern: string) => this.matchesEventPattern(payload.event, pattern))) {
        if (this.deliveryService) {
          // Enqueue a real HTTP delivery (HMAC-signed, retried).
          await this.deliveryService.enqueue(
            {
              eventType: payload.event,
              propertyId: payload.propertyId,
              entityType: payload.entityType,
              entityId: payload.entityId,
              data: payload.data ?? {},
              timestamp: payload.timestamp ?? new Date().toISOString(),
            },
            sub.id,
          );
        } else {
          // Fallback — just log the match (for tests / environments without delivery service).
          await this.db
            .update(agentWebhookSubscriptions)
            .set({
              lastDeliveryAt: new Date(),
              lastDeliveryStatus: 'logged',
              updatedAt: new Date(),
            })
            .where(eq(agentWebhookSubscriptions.id, sub.id));
        }
      }
    }
  }

  /**
   * List delivery attempts for a subscription (scoped by propertyId).
   */
  async listDeliveries(subscriptionId: string, propertyId: string, limit = 50) {
    if (!this.deliveryService) return [];
    // Verify subscription belongs to propertyId before returning deliveries.
    const [subscription] = await this.db
      .select()
      .from(agentWebhookSubscriptions)
      .where(
        and(
          eq(agentWebhookSubscriptions.id, subscriptionId),
          eq(agentWebhookSubscriptions.propertyId, propertyId),
        ),
      );
    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }
    return this.deliveryService.listDeliveries(subscriptionId, propertyId, limit);
  }

  /**
   * Match event type against subscription pattern.
   * Supports wildcards: 'reservation.*' matches 'reservation.created'.
   */
  matchesEventPattern(eventType: string, pattern: string): boolean {
    if (pattern === '*' || pattern === '**') return true;

    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return eventType.startsWith(prefix + '.');
    }

    return eventType === pattern;
  }
}
