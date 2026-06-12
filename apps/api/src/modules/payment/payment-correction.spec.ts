import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';
import { DRIZZLE } from '../../database/database.module';

const basePayment = {
  id: 'pay-001',
  propertyId: 'prop-001',
  folioId: 'folio-001',
  houseAccountId: null,
  method: 'credit_card',
  status: 'authorized',
  amount: '100.00',
  currencyCode: 'USD',
  gatewayTransactionId: 'txn-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function chainResolving(returnData: any[]) {
  return () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        then: (resolve: any) => resolve(returnData),
      }),
    }),
  });
}

function buildDb(payment: any) {
  return {
    select: vi.fn().mockImplementation(chainResolving([payment])),
    insert: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...payment, status: 'voided' }]),
        }),
      }),
    }),
    delete: vi.fn(),
  };
}

const mockWebhookService = { emit: vi.fn() };
const mockFolioService = {
  recalculateBalance: vi.fn().mockResolvedValue(undefined),
  postCharge: vi.fn().mockResolvedValue({ id: 'adj-001', type: 'adjustment' }),
};
const mockGateway = {
  authorize: vi.fn(),
  capture: vi.fn(),
  void: vi.fn().mockResolvedValue({ success: true, transactionId: 'txn-1' }),
  refund: vi.fn().mockResolvedValue({ success: true, transactionId: 'rfd-1' }),
};

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PaymentService,
      { provide: DRIZZLE, useValue: db },
      { provide: FolioService, useValue: mockFolioService },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: PAYMENT_GATEWAY, useValue: mockGateway },
    ],
  }).compile();
  return module.get<PaymentService>(PaymentService);
}

describe('PaymentService.correctPayment (correction matrix, KB 14.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('voids an authorized card payment (delegates to voidPayment)', async () => {
    const payment = { ...basePayment, status: 'authorized', method: 'credit_card' };
    const svc = await buildService(buildDb(payment));
    const result = await svc.correctPayment('pay-001', 'prop-001');
    expect(result.op).toBe('void');
    expect(mockGateway.void).toHaveBeenCalled();
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'payment.corrected',
      'payment',
      'pay-001',
      expect.objectContaining({ op: 'void' }),
      'prop-001',
    );
  });

  it('voids recent cash directly without a gateway call', async () => {
    const payment = {
      ...basePayment,
      method: 'cash',
      status: 'captured',
      gatewayTransactionId: null,
      createdAt: new Date(), // within 24h
    };
    const svc = await buildService(buildDb(payment));
    const result = await svc.correctPayment('pay-001', 'prop-001');
    expect(result.op).toBe('void');
    expect(mockGateway.void).not.toHaveBeenCalled();
    expect(mockFolioService.recalculateBalance).toHaveBeenCalledWith('folio-001', 'prop-001');
  });

  it('rejects a void override on a captured card payment (must refund)', async () => {
    const payment = { ...basePayment, status: 'captured', method: 'credit_card' };
    const svc = await buildService(buildDb(payment));
    await expect(svc.correctPayment('pay-001', 'prop-001', 'void')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockGateway.void).not.toHaveBeenCalled();
  });

  it('refunds a captured card payment', async () => {
    const payment = { ...basePayment, status: 'captured', method: 'credit_card' };
    // refundPayment loads original (select), computes existing refunds (select -> []),
    // claims (update returning), then gateway.refund, then insert refund row.
    const selectImpls = [
      chainResolving([payment])(), // correctPayment.findById
      chainResolving([payment])(), // refundPayment load original
      chainResolving([])(), // existing refunds
    ];
    let call = 0;
    const db = {
      select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'rfd-row', status: 'captured' }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...payment, status: 'refunded' }]),
          }),
        }),
      }),
      delete: vi.fn(),
    };
    const svc = await buildService(db);
    const result = await svc.correctPayment('pay-001', 'prop-001');
    expect(result.op).toBe('refund');
    expect(mockGateway.refund).toHaveBeenCalled();
  });

  it('adjusts an old cash payment via a compensating negative charge', async () => {
    const payment = {
      ...basePayment,
      method: 'cash',
      status: 'captured',
      gatewayTransactionId: null,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago, past window
    };
    const svc = await buildService(buildDb(payment));
    const result = await svc.correctPayment('pay-001', 'prop-001');
    expect(result.op).toBe('adjust');
    expect(mockFolioService.postCharge).toHaveBeenCalledWith(
      'folio-001',
      expect.objectContaining({ type: 'adjustment', amount: '-100.00', skipTaxCalculation: true }),
    );
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'payment.corrected',
      'payment',
      'pay-001',
      expect.objectContaining({ op: 'adjust' }),
      'prop-001',
    );
  });

  it('rejects an illegal override (refund on authorized hold)', async () => {
    const payment = { ...basePayment, status: 'authorized', method: 'credit_card' };
    const svc = await buildService(buildDb(payment));
    await expect(svc.correctPayment('pay-001', 'prop-001', 'refund')).rejects.toThrow(
      BadRequestException,
    );
  });
});
