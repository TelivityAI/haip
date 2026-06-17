import { Injectable } from '@nestjs/common';
import { ReportsService } from '../reports/reports.service';

/**
 * Accounting export — renders the day's numbers as plain CSV the self-hoster
 * imports into their own books (QuickBooks/Xero/spreadsheet). Reuses the existing
 * ReportsService; adds no new accounting logic. Deliberately NO hosted OAuth
 * connector (that needs vendor app-credentials + a server to hold them — not
 * appropriate for a self-hosted open-source PMS).
 */
@Injectable()
export class AccountingExportService {
  constructor(private readonly reportsService: ReportsService) {}

  /** Revenue journal for a date: one row per revenue/payment line. */
  async revenueJournalCsv(propertyId: string, date: string): Promise<string> {
    const r: any = await this.reportsService.getDailyRevenue(propertyId, date);
    const rows: Array<[string, string, number]> = [
      ['revenue', 'Room', r.revenue?.room ?? 0],
      ['revenue', 'Tax', r.revenue?.tax ?? 0],
      ['revenue', 'Food & Beverage', r.revenue?.foodBeverage ?? 0],
      ['revenue', 'Other', r.revenue?.other ?? 0],
      ['revenue', 'Total Revenue', r.revenue?.total ?? 0],
      ['adjustments', 'Adjustments', r.adjustments ?? 0],
      ['net', 'Net Revenue', r.netRevenue ?? 0],
    ];
    for (const [method, amount] of Object.entries(r.payments ?? {})) {
      if (method === 'total') continue;
      rows.push(['payment', `Payment: ${method}`, Number(amount)]);
    }
    rows.push(['payment', 'Total Payments', r.payments?.total ?? 0]);

    return toCsv(
      ['date', 'category', 'account', 'amount'],
      rows.map(([category, account, amount]) => [date, category, account, amount.toFixed(2)]),
    );
  }

  /** Daily trial balance: one row per ledger with opening→closing movement. */
  async trialBalanceCsv(propertyId: string, date: string): Promise<string> {
    const tb: any = await this.reportsService.dailyTrialBalance(propertyId, date);
    const ledgers = tb.ledgers ?? {};
    const header = ['date', 'ledger', 'opening', 'netActivity', 'transfersIn', 'transfersOut', 'closing'];
    const rows = Object.entries(ledgers).map(([name, l]: [string, any]) => [
      date,
      name,
      l.opening ?? '0.00',
      l.netActivity ?? '0.00',
      l.transfersIn ?? '0.00',
      l.transfersOut ?? '0.00',
      l.closing ?? '0.00',
    ]);
    return toCsv(header, rows);
  }
}

/** Render rows as CSV, quoting any field containing a comma/quote/newline. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  return lines.join('\n') + '\n';
}
