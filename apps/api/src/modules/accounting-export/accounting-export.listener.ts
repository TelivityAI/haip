import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebhookPayload } from '../webhook/webhook.service';
import { WebhookService } from '../webhook/webhook.service';
import { AccountingExportService } from './accounting-export.service';

/**
 * On night-audit day close, pre-generate accounting CSV exports and notify
 * subscribers via webhook — no manual download required.
 */
@Injectable()
export class AccountingExportListener {
  private readonly logger = new Logger(AccountingExportListener.name);

  constructor(
    private readonly exportService: AccountingExportService,
    private readonly webhookService: WebhookService,
  ) {}

  @OnEvent('audit.completed')
  async onAuditCompleted(payload: WebhookPayload) {
    if (!payload.propertyId) return;

    const businessDate = String(payload.data?.['businessDate'] ?? '');
    if (!businessDate) return;

    try {
      const [revenueJournal, trialBalance] = await Promise.all([
        this.exportService.revenueJournalCsv(payload.propertyId, businessDate),
        this.exportService.trialBalanceCsv(payload.propertyId, businessDate),
      ]);

      await this.webhookService.emit(
        'accounting.export.ready',
        'accounting_export',
        payload.entityId,
        {
          businessDate,
          revenueJournalLineCount: revenueJournal.split('\n').length - 1,
          trialBalanceLineCount: trialBalance.split('\n').length - 1,
          revenueJournalPreview: revenueJournal.slice(0, 500),
          trialBalancePreview: trialBalance.slice(0, 500),
          downloadPaths: {
            revenueJournal: `/api/v1/accounting-export/revenue-journal.csv?propertyId=${payload.propertyId}&date=${businessDate}`,
            trialBalance: `/api/v1/accounting-export/trial-balance.csv?propertyId=${payload.propertyId}&date=${businessDate}`,
          },
        },
        payload.propertyId,
      );
    } catch (err: any) {
      this.logger.warn(
        `Accounting export on audit.completed failed for ${payload.propertyId}: ${err?.message ?? err}`,
      );
    }
  }
}
