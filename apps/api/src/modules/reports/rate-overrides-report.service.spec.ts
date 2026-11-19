import { describe, expect, it, vi } from 'vitest';
import { RateOverridesReportService } from './rate-overrides-report.service';

function createDb(opts: {
  plans?: any[];
  restrictions?: any[];
  audits?: any[];
  syncLogs?: any[];
}) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => {
        const name = String(table?.[Symbol.for('drizzle:Name')] ?? '');
        const rows =
          name === 'rate_plans'
            ? (opts.plans ?? [])
            : name === 'rate_restrictions'
              ? (opts.restrictions ?? [])
              : name === 'audit_logs'
                ? (opts.audits ?? [])
                : name === 'ari_sync_logs'
                  ? (opts.syncLogs ?? [])
                  : [];
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
            then: (resolve: any) => resolve(rows),
          }),
        };
      }),
    })),
  };
}

describe('RateOverridesReportService', () => {
  it('rejects a malformed date instead of silently ignoring the filter', async () => {
    const service = new RateOverridesReportService(createDb({}));
    await expect(
      service.getRateOverrides({ propertyId: 'p', from: '2026-13-99x' }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('returns overrides with the plan name and redacted history', async () => {
    const db = createDb({
      plans: [{ id: 'plan-1', name: 'Best Available', code: 'BAR' }],
      restrictions: [
        {
          restrictionId: 'r1',
          ratePlanId: 'plan-1',
          startDate: '2026-11-20',
          endDate: '2026-11-22',
          rateOverride: '199.00',
          isClosed: false,
          updatedAt: new Date('2026-11-18T10:00:00.000Z'),
        },
      ],
      audits: [
        {
          id: 'a1',
          entityType: 'rate_restriction',
          entityId: 'r1',
          action: 'update',
          userEmail: 'manager@example.com',
          occurredAt: new Date('2026-11-18T10:00:00.000Z'),
          previousValue: { rateOverride: '179.00', apiKey: 'sk_live_x' },
          newValue: { rateOverride: '199.00' },
        },
      ],
      syncLogs: [],
    });
    const service = new RateOverridesReportService(db);
    const result = await service.getRateOverrides({ propertyId: 'prop' });

    expect(result.activeOverrideCount).toBe(1);
    expect(result.activeOverrides[0]).toEqual(
      expect.objectContaining({ ratePlanName: 'Best Available', rateOverride: '199.00' }),
    );
    expect((result.history[0].previousValue as any)['apiKey']).toBe('***redacted***');
    expect((result.history[0].previousValue as any)['rateOverride']).toBe('179.00');
  });
});
