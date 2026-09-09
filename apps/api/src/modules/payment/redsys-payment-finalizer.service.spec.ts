
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedsysPaymentFinalizer } from './redsys-payment-finalizer.service';

function makeFinalizer() {
  const paymentRow = {
    id: 'pay-1',
    propertyId: 'prop-1',
    folioId: 'folio-1',
    status: 'pending',
    amount: '110.00',
    currencyCode: 'EUR',
    gatewayTransactionId: '1234ORDER01',
    notes: null,
  };

  const db = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...paymentRow, status: 'authorized' }]),
        }),
      }),
    }),
    select: vi.fn(),
  };

  // Chain helpers for select().from().where().limit()
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  db.select.mockReturnValue(selectChain);

  const webhookService = { emit: vi.fn().mockResolvedValue(undefined) };
  const depositService = { recordDeposit: vi.fn().mockResolvedValue({ id: 'dep-1' }) };
  const reservationService = { confirm: vi.fn().mockResolvedValue({ id: 'res-1', status: 'confirmed' }) };

  const finalizer = new RedsysPaymentFinalizer(
    db as any,
    webhookService as any,
    depositService as any,
    reservationService as any,
  );

  return {
    finalizer,
    db,
    selectChain,
    webhookService,
    depositService,
    reservationService,
    paymentRow,
  };
}

describe('RedsysPaymentFinalizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('on success: authorizes, records deposit once, and auto-confirms when configured', async () => {
    const {
      finalizer,
      selectChain,
      depositService,
      reservationService,
      paymentRow,
    } = makeFinalizer();

    // folio lookup, existing deposit miss, booking config (refundable), booking config (autoConfirm), reservation
    selectChain.limit
      .mockResolvedValueOnce([{ id: 'folio-1', reservationId: 'res-1', propertyId: 'prop-1' }])
      .mockResolvedValueOnce([]) // no existing deposit
      .mockResolvedValueOnce([{ depositPolicy: { refundable: true } }])
      .mockResolvedValueOnce([{ autoConfirm: true }])
      .mockResolvedValueOnce([{ id: 'res-1', status: 'pending' }]);

    await finalizer.finalizeVerifiedNotification({
      payment: paymentRow as any,
      success: true,
      dsResponse: '0000',
    });

    expect(depositService.recordDeposit).toHaveBeenCalledOnce();
    expect(reservationService.confirm).toHaveBeenCalledWith('res-1', 'prop-1');
  });

  it('on success replay: skips duplicate deposit when ledger row already exists', async () => {
    const {
      finalizer,
      selectChain,
      depositService,
      reservationService,
      paymentRow,
      db,
    } = makeFinalizer();

    // Already authorized — markAuthorized short-circuits
    const authorized = { ...paymentRow, status: 'authorized' };
    db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    selectChain.limit
      .mockResolvedValueOnce([authorized]) // fresh reload after empty update
      .mockResolvedValueOnce([{ id: 'folio-1', reservationId: 'res-1', propertyId: 'prop-1' }])
      .mockResolvedValueOnce([{ id: 'dep-existing' }]) // existing deposit
      .mockResolvedValueOnce([{ autoConfirm: true }])
      .mockResolvedValueOnce([{ id: 'res-1', status: 'confirmed' }]); // already confirmed

    await finalizer.finalizeVerifiedNotification({
      payment: authorized as any,
      success: true,
      dsResponse: '0000',
    });

    expect(depositService.recordDeposit).not.toHaveBeenCalled();
    expect(reservationService.confirm).not.toHaveBeenCalled();
  });

  it('on failure: marks payment failed and never records deposit or confirms', async () => {
    const {
      finalizer,
      depositService,
      reservationService,
      paymentRow,
      webhookService,
    } = makeFinalizer();

    await finalizer.finalizeVerifiedNotification({
      payment: paymentRow as any,
      success: false,
      dsResponse: '0190',
    });

    expect(depositService.recordDeposit).not.toHaveBeenCalled();
    expect(reservationService.confirm).not.toHaveBeenCalled();
    expect(webhookService.emit).toHaveBeenCalledWith(
      'payment.failed',
      'payment',
      'pay-1',
      expect.any(Object),
      'prop-1',
    );
  });
});
