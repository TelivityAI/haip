import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebhookPayload } from '../webhook/webhook.service';
import {
  WEBHOOK_DELIVERY_FAILED,
  type WebhookDeliveryFailedEvent,
} from '../webhook/webhook-delivery.service';
import { StaffNotificationService } from './staff-notification.service';

/**
 * Listens to domain events and creates staff-facing in-app notifications.
 */
@Injectable()
export class StaffNotificationListener {
  private readonly logger = new Logger(StaffNotificationListener.name);

  constructor(private readonly staffNotifications: StaffNotificationService) {}

  @OnEvent('agent.decision_created')
  async onAgentDecision(payload: WebhookPayload) {
    if (!payload.propertyId) return;

    const data = payload.data ?? {};
    const decisionType = String(data['decisionType'] ?? '');
    const agentType = String(data['agentType'] ?? '');
    const confidence = Number(data['confidence'] ?? 0);

    const isAnomaly =
      decisionType === 'night_audit_anomaly' ||
      agentType === 'night_audit';

    if (!isAnomaly && confidence < 0.7) return;

    const severity = decisionType === 'night_audit_anomaly' ? 'critical' : 'warning';
    const title =
      decisionType === 'night_audit_anomaly'
        ? 'Night audit anomaly detected'
        : `${agentType.replace(/_/g, ' ')} alert`;

    await this.staffNotifications.create({
      propertyId: payload.propertyId,
      type: isAnomaly ? 'anomaly' : 'agent_decision',
      title,
      message: String(data['summary'] ?? `Agent ${agentType} flagged ${decisionType} for review`),
      severity,
      sourceEvent: 'agent.decision_created',
      sourceEntityType: 'agent_decision',
      sourceEntityId: payload.entityId,
    });
  }

  @OnEvent(WEBHOOK_DELIVERY_FAILED)
  async onWebhookDeliveryFailed(payload: WebhookDeliveryFailedEvent) {
    if (!payload?.propertyId) return;

    // Loop guard: creating a notification emits staff.notification_created,
    // which can itself be delivered to (and fail against) the same broken
    // endpoint — alerting on THAT failure would notify forever. Skip it; the
    // original failure already produced an alert.
    if (payload.eventType === 'staff.notification_created') return;

    const subscriber = payload.subscriberName ?? payload.subscriptionId;
    await this.staffNotifications.create({
      propertyId: payload.propertyId,
      type: 'webhook_delivery_failed',
      title: `Webhook delivery failed: ${payload.eventType}`,
      message:
        `Delivery to subscriber "${subscriber}" gave up after ${payload.attempts} attempts` +
        `${payload.lastError ? ` (${payload.lastError})` : ''}. ` +
        'The subscriber did NOT receive this event — if it powers a mandatory ' +
        'integration (e.g. government reporting), re-deliver or reconcile manually.',
      severity: 'critical',
      sourceEvent: 'webhook.delivery_failed',
      sourceEntityType: 'webhook_delivery',
      sourceEntityId: payload.deliveryId,
    });
  }

  @OnEvent('audit.completed')
  async onAuditCompleted(payload: WebhookPayload) {
    if (!payload.propertyId) return;

    const data = payload.data ?? {};
    const summary = data['summary'] as Record<string, unknown> | undefined;
    const businessDate = String(data['businessDate'] ?? '');

    const errors = Array.isArray((data as any).errors) ? (data as any).errors : [];
    if (errors.length > 0) {
      await this.staffNotifications.create({
        propertyId: payload.propertyId,
        type: 'audit_error',
        title: `Night audit completed with ${errors.length} error(s)`,
        message: `Business date ${businessDate}: review audit run before day close.`,
        severity: 'warning',
        sourceEvent: 'audit.completed',
        sourceEntityType: 'audit_run',
        sourceEntityId: payload.entityId,
      });
      return;
    }

    const netRevenue = summary?.['netRevenue'];
    if (netRevenue != null) {
      await this.staffNotifications.create({
        propertyId: payload.propertyId,
        type: 'audit_completed',
        title: 'Night audit completed',
        message: `Business date ${businessDate} closed. Net revenue: ${netRevenue}.`,
        severity: 'info',
        sourceEvent: 'audit.completed',
        sourceEntityType: 'audit_run',
        sourceEntityId: payload.entityId,
      });
    }
  }
}
