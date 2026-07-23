import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentService } from '../agent.service';
import type { WebhookPayload } from '../../webhook/webhook.service';

/**
 * Drafts guest-lifecycle emails when reservation events fire.
 *
 * Maps reservation.created → confirmation, checked_in → welcome,
 * checked_out → post_stay (see getEmailTypeForEvent). Pre-arrival / day-of
 * still come from scheduled `POST /agents/:propertyId/guest_comms/run`.
 *
 * Never throws — a draft failure must not break reservation state changes.
 */
@Injectable()
export class GuestCommsListener {
  private readonly logger = new Logger(GuestCommsListener.name);

  constructor(private readonly agentService: AgentService) {}

  @OnEvent('reservation.created')
  async onCreated(payload: WebhookPayload): Promise<void> {
    await this.trigger(payload, 'reservation.created');
  }

  @OnEvent('reservation.checked_in')
  async onCheckedIn(payload: WebhookPayload): Promise<void> {
    await this.trigger(payload, 'reservation.checked_in');
  }

  @OnEvent('reservation.checked_out')
  async onCheckedOut(payload: WebhookPayload): Promise<void> {
    await this.trigger(payload, 'reservation.checked_out');
  }

  private async trigger(payload: WebhookPayload, event: string): Promise<void> {
    if (!payload?.propertyId || !payload?.entityId) return;
    try {
      await this.agentService.runAgent(payload.propertyId, 'guest_comms', {
        triggeredBy: 'event',
        eventPayload: {
          event,
          reservationId: payload.entityId,
        },
      });
    } catch (error: any) {
      this.logger.warn(
        `guest_comms draft skipped for ${event} / ${payload.entityId}: ${error?.message ?? error}`,
      );
    }
  }
}
