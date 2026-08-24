import { describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  payments,
} from '@telivityhaip/database';
import {
  planNetAllocationReconciliation,
  reconcileBookingRequestPaymentAllocations,
} from './booking-request-allocation-reconciler';

describe('Booking Request net allocation reconciliation', () => {
  const allocations = [
    {
      id: 'allocation-1',
      installmentId: 'installment-1',
      amount: '60.00',
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
    },
    {
      id: 'allocation-2',
      installmentId: 'installment-2',
      amount: '40.00',
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
    },
  ];

  it('deterministically releases the newest allocations when net capture falls', () => {
    expect(planNetAllocationReconciliation('70.00', allocations)).toEqual({
      allocationAmounts: new Map([
        ['allocation-1', '60.00'],
        ['allocation-2', '10.00'],
      ]),
      installmentTotals: new Map([
        ['installment-1', '60.00'],
        ['installment-2', '10.00'],
      ]),
    });
  });

  it('releases every allocation when a movement is fully returned', () => {
    expect(planNetAllocationReconciliation('0.00', allocations)).toEqual({
      allocationAmounts: new Map([
        ['allocation-1', '0.00'],
        ['allocation-2', '0.00'],
      ]),
      installmentTotals: new Map([
        ['installment-1', '0.00'],
        ['installment-2', '0.00'],
      ]),
    });
  });

  it('atomically reduces persisted allocations and recomputes each installment', async () => {
    const allocationRows = allocations.map((row) => ({
      ...row,
      propertyId: 'property-1',
      bookingRequestId: 'request-1',
      paymentId: 'payment-1',
    }));
    const childRows = [{
      id: 'return-1',
      propertyId: 'property-1',
      bookingRequestId: 'request-1',
      originalPaymentId: 'payment-1',
      status: 'captured',
      amount: '-30.00',
    }];
    const installmentRows = new Map([
      ['installment-1', { id: 'installment-1', resolvedAmount: '60.00' }],
      ['installment-2', { id: 'installment-2', resolvedAmount: '40.00' }],
    ]);
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            if (table === bookingRequestPaymentAllocations) {
              return Promise.resolve(allocationRows);
            }
            if (table === payments) return Promise.resolve(childRows);
            if (table === bookingRequestInstallments) {
              return {
                for: vi.fn().mockResolvedValue([...installmentRows.values()]),
              };
            }
            return Promise.resolve([]);
          }),
        })),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updates.push({ table, values });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn().mockResolvedValue(table === auditLogs ? undefined : undefined),
      })),
    };

    await reconcileBookingRequestPaymentAllocations(tx, {
      bookingRequestId: 'request-1',
      propertyId: 'property-1',
      payment: { id: 'payment-1', amount: '100.00' },
    });

    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: bookingRequestPaymentAllocations,
        values: { amount: '10.00' },
      }),
      expect.objectContaining({
        table: bookingRequestInstallments,
        values: expect.objectContaining({ allocatedAmount: '10.00', status: 'partial' }),
      }),
    ]));
  });
});
