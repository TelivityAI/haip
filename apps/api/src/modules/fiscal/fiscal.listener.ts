import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebhookPayload } from '../webhook/webhook.service';
import { FiscalService } from './fiscal.service';

@Injectable()
export class FiscalListener {
  private readonly logger = new Logger(FiscalListener.name);

  constructor(private readonly fiscalService: FiscalService) {}

  @OnEvent('invoice.requested')
  async onInvoiceRequested(payload: WebhookPayload) {
    if (!payload?.propertyId || !payload?.entityId) return;

    try {
      await this.fiscalService.processInvoiceRequested(
        payload.propertyId,
        payload.entityId,
        payload.data,
      );
    } catch (error: any) {
      this.logger.warn(
        `Fiscal provider hook failed for document ${payload.entityId}: ${error?.message ?? error}`,
      );
    }
  }

  @OnEvent('reservation.checked_in')
  async onReservationCheckedIn(payload: WebhookPayload) {
    if (!payload?.propertyId || !payload?.entityId) return;

    try {
      await this.fiscalService.reportReservationCheckIn(
        payload.propertyId,
        payload.entityId,
        payload.data,
      );
    } catch (error: any) {
      this.logger.warn(
        `Guest-registration check-in hook failed for reservation ${payload.entityId}: ${error?.message ?? error}`,
      );
    }
  }

  @OnEvent('reservation.checked_out')
  async onReservationCheckedOut(payload: WebhookPayload) {
    if (!payload?.propertyId || !payload?.entityId) return;

    try {
      await this.fiscalService.reportReservationCheckOut(
        payload.propertyId,
        payload.entityId,
        payload.data,
      );
    } catch (error: any) {
      this.logger.warn(
        `Guest-registration check-out hook failed for reservation ${payload.entityId}: ${error?.message ?? error}`,
      );
    }
  }
}
