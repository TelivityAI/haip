import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentService } from '../agent.service';
import type { WebhookPayload } from '../../webhook/webhook.service';

/**
 * Auto-drafts review responses when new reviews are ingested (pull, cron, Channex webhook).
 *
 * Never throws — a draft failure must not break ingest.
 */
@Injectable()
export class ReviewIngestListener {
  private readonly logger = new Logger(ReviewIngestListener.name);

  constructor(private readonly agentService: AgentService) {}

  @OnEvent('guest.review.ingested')
  async onReviewIngested(payload: WebhookPayload): Promise<void> {
    if (!payload?.propertyId || !payload?.entityId) return;
    try {
      await this.agentService.runAgent(payload.propertyId, 'review_response', {
        triggeredBy: 'event',
        eventPayload: { reviewId: payload.entityId },
      });
    } catch (error: any) {
      this.logger.warn(
        `review_response draft skipped for review ${payload.entityId}: ${error?.message ?? error}`,
      );
    }
  }
}
