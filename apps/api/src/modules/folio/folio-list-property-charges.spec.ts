import { describe, expect, it, vi } from 'vitest';
import { FolioService } from './folio.service';

/**
 * Property-wide charge ledger. The behaviour that matters is (a) tenant scoping and
 * (b) that `reversalsOnly` covers every reversal shape this ledger actually uses —
 * a missed shape silently answers "no reversals" on a property that has them.
 */
function createDb(rows: any[], count = rows.length, folioRows: any[] = []) {
  const where = vi.fn().mockReturnValue({
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue(rows) }),
    }),
    then: (resolve: any) => resolve([{ count }]),
  });
  return {
    select: vi.fn().mockImplementation((shape?: any) => {
      const isCount = shape && 'count' in shape;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            if (isCount) {
              return Object.assign(Promise.resolve([{ count }]), {});
            }
            return {
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue(rows) }),
              }),
              then: (resolve: any) => resolve(folioRows),
            };
          }),
        }),
      };
    }),
  };
}

describe('FolioService.listPropertyCharges', () => {
  it('scopes every query to the requesting property', async () => {
    const db = createDb([]);
    const service = new FolioService(db, undefined as any, {} as any) as unknown as FolioService;
    // Constructor signature varies; call through the prototype to isolate the query shape.
    await (FolioService.prototype as any).listPropertyCharges.call(
      { db },
      { propertyId: 'prop-001', page: 1, limit: 50 },
    );
    expect(db.select).toHaveBeenCalled();
  });

  it('totals per currency and flags reversals', async () => {
    const rows = [
      { id: 'c1', folioId: null, type: 'room', amount: '179.00', currencyCode: 'USD', isReversal: false, adjustsChargeId: null },
      { id: 'c2', folioId: null, type: 'adjustment', amount: '-18.00', currencyCode: 'USD', isReversal: true, adjustsChargeId: null },
      { id: 'c3', folioId: null, type: 'minibar', amount: '12.00', currencyCode: 'EUR', isReversal: false, adjustsChargeId: 'c1' },
    ];
    const db = createDb(rows, rows.length);
    const result = await (FolioService.prototype as any).listPropertyCharges.call(
      { db, folioById: vi.fn() },
      { propertyId: 'prop-001', page: 1, limit: 50 },
    );

    expect(result.byCurrency.USD.total).toBeCloseTo(161);
    expect(result.byCurrency.USD.reversalsTotal).toBeCloseTo(-18);
    // A EUR row must never be folded into the USD total.
    expect(result.byCurrency.EUR.total).toBeCloseTo(12);
    expect(result.byCurrency.EUR.reversalsTotal).toBeCloseTo(12);
    expect(result.total).toBe(3);
  });
});
