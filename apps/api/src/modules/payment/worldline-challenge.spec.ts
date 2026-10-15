import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { payments, reservations } from '@telivityhaip/database';
import { PaymentService } from './payment.service';
import { WorldlineGateway } from './gateways/worldline-gateway';
import {
  WORLDLINE_CHALLENGE_ATTEMPTS,
  WORLDLINE_CHALLENGE_BACKOFF_MS,
  WORLDLINE_CHALLENGE_DELAY_MS,
  WORLDLINE_CHALLENGE_JOB_NAME,
  WorldlineChallengeQueue,
  WORLDLINE_CHALLENGE_EXPIRER,
} from './worldline-challenge.queue';

const CREDS = { merchantId: 'm', apiKeyId: 'k', secretApiKey: 's', environment: 'test' as const };

function authorizeDb(row: Record<string, unknown>) {
  const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
  return { insert: vi.fn().mockReturnValue({ values }), values };
}

describe('Worldline challenge deadline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedules a deadline only for a pending Worldline authorization', async () => {
    const row = { id: 'pay-001', amount: '40.00', folioId: 'folio-1', propertyId: 'prop-1' };
    const db = authorizeDb(row);
    const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) };
    const gateway = {
      authorize: vi.fn().mockResolvedValue({
        success: true,
        transactionId: 'wl-1',
        providerStatus: 'requires_action',
        nextAction: { type: 'redirect', method: 'GET', url: 'https://bank.example/3ds', formFields: {} },
      }),
    };
    const credentials = { resolveForProperty: vi.fn().mockResolvedValue(CREDS) };
    const svc = new PaymentService(
      db as any,
      { findById: vi.fn().mockResolvedValue({ id: 'folio-1', status: 'open', reservationId: 'res-1' }), recalculateBalance: vi.fn() } as any,
      gateway as any,
      { emit: vi.fn(), dispatchPersisted: vi.fn() } as any,
      { get: vi.fn() } as any,
      { resolveForProperty: vi.fn() } as any,
      credentials as any,
      scheduler as any,
    );
    await svc.authorizePayment({
      folioId: 'folio-1',
      propertyId: 'prop-1',
      amount: '40.00',
      currencyCode: 'EUR',
      gatewayProvider: 'worldline',
      gatewayPaymentToken: 'ht-1',
      redirectUrlOk: 'https://hotel.example/return',
    });
    expect(scheduler.schedule).toHaveBeenCalledWith('pay-001', 'prop-1');

    gateway.authorize.mockResolvedValue({
      success: true,
      transactionId: 'pi_1',
      providerStatus: 'requires_action',
      nextAction: { type: 'redirect', method: 'POST', url: 'https://bank.example', formFields: { a: 'b' } },
    });
    scheduler.schedule.mockClear();
    await svc.authorizePayment({
      folioId: 'folio-1',
      propertyId: 'prop-1',
      amount: '40.00',
      currencyCode: 'EUR',
      gatewayProvider: 'stripe',
      gatewayPaymentToken: 'pm_1',
    });
    expect(scheduler.schedule).not.toHaveBeenCalled();

    gateway.authorize.mockResolvedValue({
      success: true,
      transactionId: 'wl-open',
      providerStatus: 'pending',
    });
    scheduler.schedule.mockClear();
    db.values.mockClear();
    await svc.authorizePayment({
      folioId: 'folio-1',
      propertyId: 'prop-1',
      amount: '40.00',
      currencyCode: 'EUR',
      gatewayProvider: 'worldline',
      gatewayPaymentToken: 'ht-open',
      redirectUrlOk: 'https://hotel.example/return',
    });
    expect(scheduler.schedule).toHaveBeenCalledWith('pay-001', 'prop-1');
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', gatewayTransactionId: 'wl-open' }));
  });

  it('still returns the bank redirect when the deadline cannot be scheduled', async () => {
    const row = { id: 'pay-001', amount: '40.00', folioId: 'folio-1', propertyId: 'prop-1' };
    const db = authorizeDb(row);
    const scheduler = { schedule: vi.fn().mockRejectedValue(new Error('redis down')) };
    const svc = new PaymentService(
      db as any,
      { findById: vi.fn().mockResolvedValue({ id: 'folio-1', status: 'open' }), recalculateBalance: vi.fn() } as any,
      {
        authorize: vi.fn().mockResolvedValue({
          success: true,
          transactionId: 'wl-1',
          providerStatus: 'requires_action',
          nextAction: { type: 'redirect', method: 'GET', url: 'https://bank.example/3ds', formFields: {} },
        }),
      } as any,
      { emit: vi.fn(), dispatchPersisted: vi.fn() } as any,
      { get: vi.fn() } as any,
      { resolveForProperty: vi.fn() } as any,
      { resolveForProperty: vi.fn().mockResolvedValue(CREDS) } as any,
      scheduler as any,
    );
    await expect(svc.authorizePayment({
      folioId: 'folio-1',
      propertyId: 'prop-1',
      amount: '40.00',
      currencyCode: 'EUR',
      gatewayProvider: 'worldline',
      gatewayPaymentToken: 'ht-1',
      redirectUrlOk: 'https://hotel.example/return',
    })).resolves.toMatchObject({ id: 'pay-001', nextAction: { url: 'https://bank.example/3ds' } });
  });

  it('resolves in Nest without a Redis connection', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorldlineChallengeQueue,
        { provide: WORLDLINE_CHALLENGE_EXPIRER, useValue: { expireWorldlineChallenge: vi.fn() } },
      ],
    }).compile();
    await moduleRef.init();
    expect(moduleRef.get(WorldlineChallengeQueue)).toBeInstanceOf(WorldlineChallengeQueue);
    await moduleRef.close();
  });

  it('enqueues the deadline on the injected queue and does not open Redis', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const scheduler = new WorldlineChallengeQueue(undefined, { add });
    await scheduler.schedule('pay-1', 'prop-1');
    expect(add).toHaveBeenCalledWith(
      WORLDLINE_CHALLENGE_JOB_NAME,
      { paymentId: 'pay-1', propertyId: 'prop-1' },
      expect.objectContaining({
        delay: WORLDLINE_CHALLENGE_DELAY_MS,
        jobId: 'worldline-challenge-pay-1',
        attempts: WORLDLINE_CHALLENGE_ATTEMPTS,
        backoff: { type: 'exponential', delay: WORLDLINE_CHALLENGE_BACKOFF_MS },
      }),
    );
  });

  it('fails and cancels an unpaid booking when the challenge is still pending', async () => {
    const payment = {
      id: 'pay-1',
      propertyId: 'prop-1',
      folioId: 'folio-1',
      amount: '40.00',
      currencyCode: 'EUR',
      gatewayProvider: 'worldline',
      gatewayTransactionId: 'wl-1',
      status: 'pending',
      authorizationFinalization: {
        deposit: { reservationId: 'res-1', isRefundable: true, autoConfirm: true },
      },
    };
    const reservationWrites: Record<string, unknown>[] = [];
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([payment]),
        }),
      }),
      transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              if (table === reservations) reservationWrites.push(values);
              const done = Promise.resolve(undefined);
              return Object.assign(done, {
                returning: async () => (table === payments ? [payment] : []),
              });
            },
          }),
        }),
        select: () => ({
          from: (table: unknown) => ({
            where: () => {
              const rows = table === reservations ? [{
                id: 'res-1',
                status: 'pending',
                arrivalDate: '2026-11-01',
                departureDate: '2026-11-03',
                roomTypeId: 'rt-1',
              }] : [];
              return Object.assign(Promise.resolve(rows), { for: async () => rows });
            },
          }),
        }),
        insert: () => ({
          values: () => {
            const done = Promise.resolve(undefined);
            return Object.assign(done, {
              returning: async () => [{ id: 'dep-1', amount: '40.00', status: 'held', isRefundable: true }],
            });
          },
        }),
      })),
    };
    const dispatchPersisted = vi.fn();
    const svc = new PaymentService(
      db as any,
      { recalculateBalance: vi.fn(), findById: vi.fn() } as any,
      {} as any,
      { emit: vi.fn(), dispatchPersisted } as any,
      { get: vi.fn() } as any,
      {} as any,
      { resolveForProperty: vi.fn().mockResolvedValue(CREDS) } as any,
    );
    vi.spyOn(WorldlineGateway.prototype, 'readAuthorization').mockResolvedValue({ outcome: 'pending', paymentId: 'wl-1' });
    const voided = vi.spyOn(WorldlineGateway.prototype, 'void').mockResolvedValue({ success: true, transactionId: 'wl-1' });
    await svc.expireWorldlineChallenge('pay-1', 'prop-1');
    expect(voided).toHaveBeenCalledWith('wl-1', expect.objectContaining({ worldlineCredentials: CREDS }));
    expect(reservationWrites).toEqual([
      expect.objectContaining({ status: 'cancelled', cancellationReason: 'Payment was not authorized' }),
    ]);
    expect(dispatchPersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.failed',
        data: expect.objectContaining({ error: 'Bank challenge was not completed' }),
      }),
      expect.any(String),
    );
    expect(dispatchPersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reservation.cancelled',
        data: expect.objectContaining({
          arrivalDate: '2026-11-01',
          departureDate: '2026-11-03',
          roomTypeId: 'rt-1',
          penaltyAmount: null,
        }),
      }),
      expect.any(String),
    );
  });

  it('leaves the booking pending when the provider hold cannot be cancelled', async () => {
    const payment = {
      id: 'pay-1',
      propertyId: 'prop-1',
      folioId: 'folio-1',
      amount: '40.00',
      currencyCode: 'EUR',
      gatewayProvider: 'worldline',
      gatewayTransactionId: 'wl-1',
      status: 'pending',
      authorizationFinalization: {
        deposit: { reservationId: 'res-1', isRefundable: true, autoConfirm: true },
      },
    };
    const transaction = vi.fn();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([payment]) }),
      }),
      transaction,
    };
    const svc = new PaymentService(
      db as any,
      { recalculateBalance: vi.fn(), findById: vi.fn() } as any,
      {} as any,
      { emit: vi.fn(), dispatchPersisted: vi.fn() } as any,
      { get: vi.fn() } as any,
      {} as any,
      { resolveForProperty: vi.fn().mockResolvedValue(CREDS) } as any,
    );
    vi.spyOn(WorldlineGateway.prototype, 'readAuthorization').mockResolvedValue({ outcome: 'pending', paymentId: 'wl-1' });
    vi.spyOn(WorldlineGateway.prototype, 'void').mockResolvedValue({ success: false, transactionId: 'wl-1', errorMessage: 'Void failed' });
    await expect(svc.expireWorldlineChallenge('pay-1', 'prop-1')).rejects.toThrow(/cancelled at the provider/i);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('fails the expiry job when the expirer is missing', async () => {
    const scheduler = new WorldlineChallengeQueue(undefined, { add: vi.fn() });
    await expect(scheduler.processJob({ paymentId: 'pay-1', propertyId: 'prop-1' })).rejects.toThrow(/expirer/i);
  });

  it('does not open a queue when the active gateway is not worldline', () => {
    const previousNodeEnv = process.env['NODE_ENV'];
    const previousGateway = process.env['PAYMENT_GATEWAY'];
    process.env['NODE_ENV'] = 'development';
    process.env['PAYMENT_GATEWAY'] = 'redsys';
    try {
      const scheduler = new WorldlineChallengeQueue();
      scheduler.onModuleInit();
      expect((scheduler as unknown as { ownsQueue: boolean }).ownsQueue).toBe(false);
    } finally {
      process.env['NODE_ENV'] = previousNodeEnv;
      if (previousGateway === undefined) delete process.env['PAYMENT_GATEWAY'];
      else process.env['PAYMENT_GATEWAY'] = previousGateway;
    }
  });

  it('does not cancel a booking when the bank status read is unavailable', async () => {
    const transaction = vi.fn();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'pay-1',
            propertyId: 'prop-1',
            gatewayProvider: 'worldline',
            gatewayTransactionId: 'wl-1',
            status: 'pending',
          }]),
        }),
      }),
      transaction,
    };
    const svc = new PaymentService(
      db as any,
      { recalculateBalance: vi.fn() } as any,
      {} as any,
      { emit: vi.fn(), dispatchPersisted: vi.fn() } as any,
      { get: vi.fn() } as any,
      {} as any,
      { resolveForProperty: vi.fn().mockResolvedValue(null) } as any,
    );
    await expect(svc.expireWorldlineChallenge('pay-1', 'prop-1')).rejects.toThrow(/unavailable/i);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does nothing when the payment is no longer pending', async () => {
    const transaction = vi.fn();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      transaction,
    };
    const svc = new PaymentService(
      db as any,
      { recalculateBalance: vi.fn() } as any,
      {} as any,
      { emit: vi.fn(), dispatchPersisted: vi.fn() } as any,
      { get: vi.fn() } as any,
      {} as any,
      { resolveForProperty: vi.fn() } as any,
    );
    await svc.expireWorldlineChallenge('pay-1', 'prop-1');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('recalculates the folio when the challenge read is a capture', async () => {
    vi.spyOn(WorldlineGateway.prototype, 'readAuthorization').mockResolvedValue({
      outcome: 'captured',
      paymentId: 'wl-pay',
    });
    const writes: Record<string, unknown>[] = [];
    const db = {
      transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              writes.push(values);
              const done = Promise.resolve(undefined);
              return Object.assign(done, {
                returning: async () => [{
                  id: 'pay-1',
                  folioId: 'folio-1',
                  amount: '40.00',
                  currencyCode: 'EUR',
                  authorizationFinalization: null,
                }],
              });
            },
          }),
        }),
        select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
        insert: () => ({ values: async () => undefined }),
      })),
    };
    const recalculateBalance = vi.fn();
    const svc = new PaymentService(
      db as any,
      { recalculateBalance, findById: vi.fn() } as any,
      {} as any,
      { emit: vi.fn(), dispatchPersisted: vi.fn() } as any,
      { get: vi.fn() } as any,
      {} as any,
      { resolveForProperty: vi.fn().mockResolvedValue(CREDS) } as any,
    );
    await expect(svc.syncWorldlineHostedCheckout({
      id: 'pay-1',
      propertyId: 'prop-1',
      folioId: 'folio-1',
      gatewayProvider: 'worldline',
      gatewayTransactionId: 'wl-1',
      status: 'pending',
    })).resolves.toBe('captured');
    expect(writes[0]).toMatchObject({ status: 'captured' });
    expect(writes[0]?.processedAt).toBeInstanceOf(Date);
    expect(recalculateBalance).toHaveBeenCalledWith('folio-1', 'prop-1');
  });
});
