import { describe, expect, it, vi } from 'vitest';
import { withAcceptedPricingLock } from './accepted-pricing-lock';

describe('withAcceptedPricingLock', () => {
  it('obtains the reservation-scoped transaction lock before running work', async () => {
    const order: string[] = [];
    const tx = {
      execute: vi.fn(async () => {
        order.push('lock');
      }),
    };
    const db = {
      transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<string>) =>
        work(tx)),
    };

    const result = await withAcceptedPricingLock(
      db,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      async (transaction) => {
        expect(transaction).toBe(tx);
        order.push('work');
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(order).toEqual(['lock', 'work']);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledOnce();
  });

  it('reuses a caller transaction instead of nesting another transaction', async () => {
    const tx = { execute: vi.fn(async () => undefined) };
    const db = { transaction: vi.fn() };

    await withAcceptedPricingLock(
      db,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      async (transaction) => transaction,
      tx,
    );

    expect(db.transaction).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledOnce();
  });
});
