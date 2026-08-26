import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { auditLogs } from '@telivityhaip/database';
import { type WebhookEvent } from '@telivityhaip/shared';
import { DRIZZLE } from '../../database/database.module';

export interface WebhookPayload {
  event: string;
  entityType: string;
  entityId: string;
  propertyId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class WebhookService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Emit a webhook event and log it to the audit trail.
   */
  async emit(
    event: WebhookEvent,
    entityType: string,
    entityId: string,
    data: Record<string, unknown>,
    propertyId?: string,
  ): Promise<void> {
    const payload: WebhookPayload = {
      event,
      entityType,
      entityId,
      propertyId,
      data,
      timestamp: new Date().toISOString(),
    };

    // Emit via EventEmitter2 for internal listeners
    this.eventEmitter.emit(event, payload);

    // Log to audit trail
    await this.db.insert(auditLogs).values({
      propertyId: propertyId ?? null,
      action: 'create',
      entityType,
      entityId,
      description: `Webhook event: ${event}`,
      newValue: payload,
    });
  }
}
