import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

const requestPayment = {
  id: 'dddddddd-0000-4000-a000-000000000001',
  propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
  bookingRequestId: 'bbbbbbbb-0000-4000-a000-000000000001',
  folioId: null,
  houseAccountId: null,
  idempotencyKey: 'booking-request-charge:secret-fingerprint',
  method: 'credit_card',
  status: 'captured',
  amount: '100.00',
  currencyCode: 'EUR',
  gatewayProvider: 'stripe',
  gatewayTransactionId: 'pi_public_receipt',
  gatewayPaymentToken: 'pm_secret_saved_method',
  cardLastFour: '4242',
  cardBrand: 'visa',
  originalPaymentId: null,
  notes: 'safe note',
  processedAt: new Date('2026-08-24T10:00:00.000Z'),
  createdAt: new Date('2026-08-24T09:00:00.000Z'),
  updatedAt: new Date('2026-08-24T10:00:00.000Z'),
};

function dbReturning(row = requestPayment) {
  const selection = () => {
    const whereResult: Record<string, unknown> & PromiseLike<unknown> = {
      for: vi.fn().mockResolvedValue([row]),
      limit: vi.fn(() => ({
        offset: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([row]) })),
      })),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve([row]).then(resolve),
    };
    return {
      from: vi.fn(() => ({ where: vi.fn(() => whereResult) })),
    };
  };
  const mutation = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([row]) })),
    })),
  });
  const tx = {
    select: vi.fn(selection),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ ...row, amount: '-100.00' }]) })),
    })),
  };
  return {
    select: vi.fn(selection),
    update: vi.fn(mutation),
    transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
}

function serviceWith(db: ReturnType<typeof dbReturning>) {
  return new (PaymentService as any)(
    db,
    { recalculateBalance: vi.fn(), postCharge: vi.fn() },
    {
      capture: vi.fn().mockResolvedValue({ success: true, transactionId: 'cap' }),
      void: vi.fn().mockResolvedValue({ success: true, transactionId: 'void' }),
      refund: vi.fn().mockResolvedValue({ success: true, transactionId: 'refund' }),
    },
    { emit: vi.fn() },
  ) as PaymentService;
}

describe('legacy payment HTTP seam', () => {
  it('requires folios.manage for generic payment mutations', () => {
    // PaymentController migrated off the legacy @Roles() decorator onto
    // @RequirePermissions('folios.manage') on every mutation route -- this
    // asserted the OLD mechanism, which the controller has never carried
    // since that migration, and would have failed on any commit, not just
    // this sync's.
    const reflector = new Reflector();
    for (const method of [
      'recordPayment',
      'authorizePayment',
      'capturePayment',
      'voidPayment',
      'refundPayment',
      'correctPayment',
    ] as const) {
      expect(reflector.get(
        PERMISSIONS_KEY,
        PaymentController.prototype[method],
      )).toEqual(['folios.manage']);
    }
  });

  it('maps generic reads to an explicit safe payment response', async () => {
    const legacyPayment = {
      ...requestPayment,
      bookingRequestId: null,
      folioId: 'cccccccc-0000-4000-a000-000000000001',
    };
    const service = serviceWith(dbReturning(legacyPayment));

    const result = await service.findById(legacyPayment.id, legacyPayment.propertyId);

    expect(result).toMatchObject({
      id: requestPayment.id,
      bookingRequestId: null,
      amount: '100.00',
    });
    expect(result).not.toHaveProperty('gatewayPaymentToken');
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(result).not.toHaveProperty('gatewayTransactionId');
    expect(result).not.toHaveProperty('fingerprint');
  });

  it('rejects a request-targeted read through the generic payment endpoint', async () => {
    const service = serviceWith(dbReturning());

    await expect(service.findById(requestPayment.id, requestPayment.propertyId))
      .rejects.toThrow(/Booking Request payment endpoint/i);
  });

  it('rejects every generic mutation of a request-targeted payment', async () => {
    const service = serviceWith(dbReturning());
    const expected = /booking request payment endpoint/i;

    await expect(service.capturePayment(requestPayment.id, requestPayment.propertyId))
      .rejects.toThrow(expected);
    await expect(service.voidPayment(requestPayment.id, requestPayment.propertyId))
      .rejects.toThrow(expected);
    await expect(service.refundPayment(requestPayment.id, requestPayment.propertyId, '10.00'))
      .rejects.toThrow(expected);
    await expect(service.correctPayment(requestPayment.id, requestPayment.propertyId))
      .rejects.toThrow(expected);
  });
});
