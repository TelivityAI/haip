import { describe, it, expect, vi } from 'vitest';
import { AccountingExportService, toCsv } from './accounting-export.service';

const PROP = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('toCsv', () => {
  it('quotes fields containing commas/quotes', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"']]);
    expect(csv).toBe('a,b\n"x,y","he said ""hi"""\n');
  });
});

describe('AccountingExportService', () => {
  it('renders a revenue journal CSV from the daily revenue report', async () => {
    const reports: any = {
      getDailyRevenue: vi.fn().mockResolvedValue({
        date: '2026-06-17',
        revenue: { room: 1000, tax: 130, foodBeverage: 50, other: 0, total: 1180 },
        payments: { credit_card: 900, cash: 280, total: 1180 },
        adjustments: 0,
        netRevenue: 1180,
      }),
    };
    const svc = new AccountingExportService(reports);
    const csv = await svc.revenueJournalCsv(PROP, '2026-06-17');
    expect(csv).toContain('date,category,account,amount');
    expect(csv).toContain('2026-06-17,revenue,Room,1000.00');
    expect(csv).toContain('Payment: credit_card,900.00');
    expect(csv).toContain('Total Payments,1180.00');
  });

  it('renders a trial-balance CSV from the daily trial balance', async () => {
    const reports: any = {
      dailyTrialBalance: vi.fn().mockResolvedValue({
        ledgers: {
          deposit: { opening: '0.00', netActivity: '110.00', transfersIn: '0.00', transfersOut: '0.00', closing: '110.00' },
          ar: { opening: '500.00', netActivity: '0.00', transfersIn: '200.00', transfersOut: '0.00', closing: '700.00' },
        },
      }),
    };
    const svc = new AccountingExportService(reports);
    const csv = await svc.trialBalanceCsv(PROP, '2026-06-17');
    expect(csv).toContain('date,ledger,opening,netActivity,transfersIn,transfersOut,closing');
    expect(csv).toContain('2026-06-17,deposit,0.00,110.00,0.00,0.00,110.00');
    expect(csv).toContain('2026-06-17,ar,500.00,0.00,200.00,0.00,700.00');
  });
});
