import { describe, expect, it, vi } from 'vitest';
import { withAcceptedPricingLock } from './accepted-pricing-lock';

function predicateValues(value: any, values: unknown[] = []) {
  if (!value || typeof value !== 'object') return values;
  if ('value' in value) {
    if (Array.isArray(value.value)) values.push(...value.value);
    else values.push(value.value);
  }
  if (Array.isArray(value.queryChunks)) {
    for (const chunk of value.queryChunks) predicateValues(chunk, values);
  }
  return values;
}

function lockHarness(rows: Array<{ id: string; propertyId: string }> = [{
  id: '22222222-2222-4222-8222-222222222222',
  propertyId: '11111111-1111-4111-8111-111111111111',
}]) {
  const order: string[] = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((predicate) => ({
          for: vi.fn(async () => {
            order.push('lock');
            const values = predicateValues(predicate);
            return rows.filter((row) => (
              values.includes(row.id) && values.includes(row.propertyId)
            ));
          }),
        })),
      })),
    })),
  };
  const db = {
    transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { db, tx, order };
}

describe('withAcceptedPricingLock', () => {
  it('locks the scoped reservation row before running work', async () => {
    const harness = lockHarness();

    const result = await withAcceptedPricingLock(
      harness.db,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      async (transaction) => {
        expect(transaction).toBe(harness.tx);
        harness.order.push('work');
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(harness.order).toEqual(['lock', 'work']);
  });

  it('does not run work when the reservation is absent from the property', async () => {
    const harness = lockHarness();
    let workRan = false;

    await expect(withAcceptedPricingLock(
      harness.db,
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      async () => {
        workRan = true;
      },
    )).rejects.toThrow(/reservation .* not found.*accepted-pricing lock/i);

    expect(workRan).toBe(false);
  });

  it('reuses a caller transaction instead of nesting another transaction', async () => {
    const harness = lockHarness();

    const result = await withAcceptedPricingLock(
      harness.db,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      async (transaction) => transaction,
      harness.tx,
    );

    expect(result).toBe(harness.tx);
    expect(harness.db.transaction).not.toHaveBeenCalled();
    expect(harness.order).toEqual(['lock']);
  });
});
