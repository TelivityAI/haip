import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebhookPayload } from '../webhook/webhook.service';
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
