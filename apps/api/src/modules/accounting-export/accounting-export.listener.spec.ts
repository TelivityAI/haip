import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountingExportListener } from './accounting-export.listener';

describe('AccountingExportListener', () => {
  let listener: AccountingExportListener;
  let exportService: any;
  let webhookService: any;

  beforeEach(() => {
    exportService = {
      revenueJournalCsv: vi.fn().mockResolvedValue('date,category,account,amount\n'),
      trialBalanceCsv: vi.fn().mockResolvedValue('date,ledger,opening\n'),
    };
    webhookService = { emit: vi.fn().mockResolvedValue(undefined) };
    listener = new AccountingExportListener(exportService, webhookService);
  });

  it('emits accounting.export.ready on audit.completed', async () => {
    await listener.onAuditCompleted({
      event: 'audit.completed',
      entityType: 'audit_run',
      entityId: 'audit-1',
      propertyId: 'prop-1',
      data: { businessDate: '2026-07-08' },
      timestamp: new Date().toISOString(),
    });

    expect(exportService.revenueJournalCsv).toHaveBeenCalledWith('prop-1', '2026-07-08');
    expect(exportService.trialBalanceCsv).toHaveBeenCalledWith('prop-1', '2026-07-08');
    expect(webhookService.emit).toHaveBeenCalledWith(
      'accounting.export.ready',
      'accounting_export',
      'audit-1',
      expect.objectContaining({
        businessDate: '2026-07-08',
        downloadPaths: expect.objectContaining({
          revenueJournal: expect.stringContaining('revenue-journal.csv'),
        }),
      }),
      'prop-1',
    );
  });

  it('skips when propertyId or businessDate missing', async () => {
    await listener.onAuditCompleted({
      event: 'audit.completed',
      entityType: 'audit_run',
      entityId: 'audit-1',
      data: {},
      timestamp: new Date().toISOString(),
    });
    expect(webhookService.emit).not.toHaveBeenCalled();
  });
});
