import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';

const mockFolio = {
  id: 'folio-001',
  propertyId: 'prop-001',
  status: 'open',
  balance: '150.00',
};

const mockPayment = {
  id: 'pay-001',
  propertyId: 'prop-001',
  folioId: 'folio-001',
  method: 'cash',
  status: 'captured',
  amount: '150.00',
  currencyCode: 'USD',
  gatewayTransactionId: 'mock-auth-123',
  processedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockDb(returnData: any[] = [mockPayment]) {
  const selectChain = () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(returnData),
          }),
        }),
        then: (resolve: any) => resolve(returnData),
      }),
    }),
  });

  const mutateChain = () => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnData),
      }),
    }),
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
  });

  return {
    select: vi.fn().mockImplementation(selectChain),
    insert: vi.fn().mockReturnValue(mutateChain()),
    update: vi.fn().mockReturnValue(mutateChain()),
    delete: vi.fn().mockReturnValue(mutateChain()),
  };
}

const mockFolioService = {
  findById: vi.fn().mockResolvedValue(mockFolio),
  recalculateBalance: vi.fn(),
};

const mockGateway = {
  authorize: vi.fn().mockResolvedValue({ success: true, transactionId: 'mock-auth-123' }),
  capture: vi.fn().mockResolvedValue({ success: true, transactionId: 'mock-cap-123' }),
  void: vi.fn().mockResolvedValue({ success: true, transactionId: 'mock-void-123' }),
  refund: vi.fn().mockResolvedValue({ success: true, transactionId: 'mock-ref-123' }),
};

const mockWebhookService = { emit: vi.fn() };

describe('PaymentService', () => {
  let service: PaymentService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    vi.clearAllMocks();
    mockFolioService.findById.mockResolvedValue(mockFolio);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: FolioService, useValue: mockFolioService },
        { provide: PAYMENT_GATEWAY, useValue: mockGateway },
        { provide: WebhookService, useValue: mockWebhookService },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  describe('recordPayment', () => {
    it('should record cash payment with status captured and recalculate balance', async () => {
      const result = await service.recordPayment({
        folioId: 'folio-001',
        propertyId: 'prop-001',
        method: 'cash',
        amount: '150.00',
        currencyCode: 'USD',
      });

      expect(result).toEqual(mockPayment);
      expect(mockFolioService.recalculateBalance).toHaveBeenCalledWith('folio-001', 'prop-001');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.received',
        'payment',
        mockPayment.id,
        expect.objectContaining({ status: 'captured' }),
        'prop-001',
      );
    });

    it('should reject credit_card method', async () => {
      await expect(
        service.recordPayment({
          folioId: 'folio-001',
          propertyId: 'prop-001',
          method: 'credit_card',
          amount: '150.00',
          currencyCode: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('authorizePayment', () => {
    it('should call gateway and create authorized payment', async () => {
      const authPayment = { ...mockPayment, status: 'authorized', isPreAuthorization: true };
      const db = createMockDb([authPayment]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: PAYMENT_GATEWAY, useValue: mockGateway },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<PaymentService>(PaymentService);

      const result = await svc.authorizePayment({
        folioId: 'folio-001',
        propertyId: 'prop-001',
        amount: '500.00',
        currencyCode: 'USD',
        gatewayProvider: 'stripe',
        gatewayPaymentToken: 'tok_test_123',
      });

      expect(mockGateway.authorize).toHaveBeenCalledWith('tok_test_123', 500, 'USD');
      expect(result.status).toBe('authorized');
      // Pre-auth does NOT recalculate balance
      expect(mockFolioService.recalculateBalance).not.toHaveBeenCalled();
    });

    it('should handle gateway failure', async () => {
      const failedGateway = {
        ...mockGateway,
        authorize: vi.fn().mockResolvedValue({
          success: false,
          transactionId: 'failed-123',
          errorMessage: 'Insufficient funds',
        }),
      };
      const failedPayment = { ...mockPayment, status: 'failed' };
      const db = createMockDb([failedPayment]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: PAYMENT_GATEWAY, useValue: failedGateway },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<PaymentService>(PaymentService);

      await expect(
        svc.authorizePayment({
          folioId: 'folio-001',
          propertyId: 'prop-001',
          amount: '500.00',
          currencyCode: 'USD',
          gatewayProvider: 'stripe',
          gatewayPaymentToken: 'tok_test_123',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.failed',
        'payment',
        failedPayment.id,
        expect.objectContaining({ error: 'Insufficient funds' }),
        'prop-001',
      );
    });
  });

  describe('capturePayment', () => {
    it('should capture authorized payment and recalculate balance', async () => {
      const authorizedPayment = { ...mockPayment, status: 'authorized' };
      const capturedPayment = { ...mockPayment, status: 'captured' };
      let selectCallCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCallCount++;
                resolve(selectCallCount === 1 ? [authorizedPayment] : []);
              },
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([capturedPayment]),
            }),
          }),
        }),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: PAYMENT_GATEWAY, useValue: mockGateway },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<PaymentService>(PaymentService);

      const result = await svc.capturePayment('pay-001', 'prop-001');
      expect(result.status).toBe('captured');
      expect(mockGateway.capture).toHaveBeenCalled();
      expect(mockFolioService.recalculateBalance).toHaveBeenCalled();
    });

    it('should reject capture of non-authorized payment', async () => {
      const capturedPayment = { ...mockPayment, status: 'captured' };
      // Bug 1: atomic update-by-status filter returns [] when status isn't
      // 'authorized'. The service then SELECTs to report the actual status.
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([capturedPayment]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: PAYMENT_GATEWAY, useValue: mockGateway },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<PaymentService>(PaymentService);

      // Bug 1: atomic claim now returns ConflictException when status isn't 'authorized'
      await expect(svc.capturePayment('pay-001', 'prop-001')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('voidPayment', () => {
    it('should void an authorized payment', async () => {
      const authorizedPayment = { ...mockPayment, status: 'authorized' };
      const voidedPayment = { ...mockPayment, status: 'voided' };
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([authorizedPayment]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([voidedPayment]),
            }),
          }),
        }),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: PAYMENT_GATEWAY, useValue: mockGateway },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<PaymentService>(PaymentService);

      const result = await svc.voidPayment('pay-001', 'prop-001');
      expect(result.status).toBe('voided');
      expect(mockGateway.void).toHaveBeenCalled();
    });
  });

  describe('refundPayment', () => {
    it('should create a negative refund child without flipping parent status', async () => {
      const capturedPayment = { ...mockPayment, status: 'captured' };
      const refundPayment = { ...mockPayment, id: 'pay-002', amount: '-150.00', originalPaymentId: 'pay-001' };
      let txRound = 0;
      const makeTx = () => {
        txRound++;
        let selectCall = 0;
        return {
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                selectCall++;
                if (selectCall === 1) {
                  return { for: vi.fn().mockResolvedValue([capturedPayment]) };
                }
                return { then: (resolve: any) => resolve([]) };
              }),
            }),
          })),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([refundPayment]),
            }),
          }),
        };
      };
      const db = {
        transaction: vi.fn(async (fn: any) => fn(makeTx())),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: PAYMENT_GATEWAY, useValue: mockGateway },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<PaymentService>(PaymentService);

      const result = await svc.refundPayment('pay-001', 'prop-001');
      expect(db.update).not.toHaveBeenCalled();
      expect(mockGateway.refund).toHaveBeenCalled();
      expect(mockFolioService.recalculateBalance).toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.refunded',
        'payment',
        refundPayment.id,
        expect.any(Object),
        'prop-001',
      );
      expect(result).toEqual(refundPayment);
    });

    // Partial refunds: parent stays captured; negative children net the folio balance.
    describe('multi-refund partial scenario', () => {
      function buildRefundTxDb(
        original: any,
        prepareRefunds: any[],
        postGatewayRefunds: any[],
        insertedRefund: any,
      ) {
        let txRound = 0;
        const makeTx = () => {
          txRound++;
          const refundsForTx = txRound === 1 ? prepareRefunds : postGatewayRefunds;
          let selectCall = 0;
          return {
            select: vi.fn().mockImplementation(() => ({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockImplementation(() => {
                  selectCall++;
                  if (selectCall === 1) {
                    return {
                      for: vi.fn().mockResolvedValue([original]),
                    };
                  }
                  return {
                    then: (resolve: any) => resolve(refundsForTx),
                  };
                }),
              }),
            })),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([insertedRefund]),
              }),
            }),
          };
        };
        return {
          transaction: vi.fn(async (fn: any) => fn(makeTx())),
          update: vi.fn(),
          delete: vi.fn(),
        };
      }

      async function svcWith(db: any) {
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            PaymentService,
            { provide: DRIZZLE, useValue: db },
            { provide: FolioService, useValue: mockFolioService },
            { provide: PAYMENT_GATEWAY, useValue: mockGateway },
            { provide: WebhookService, useValue: mockWebhookService },
          ],
        }).compile();
        return module.get<PaymentService>(PaymentService);
      }

      const capturedOriginal = { ...mockPayment, amount: '100.00', status: 'captured' };
      const partialOriginal = { ...mockPayment, amount: '100.00', status: 'partially_refunded' };

      it('first partial refund inserts a negative child without flipping parent status', async () => {
        const db = buildRefundTxDb(
          capturedOriginal,
          [],
          [],
          { id: 'refund-1', amount: '-50.00', originalPaymentId: 'pay-001' },
        );
        const svc = await svcWith(db);
        await svc.refundPayment('pay-001', 'prop-001', '50.00');
        expect(db.update).not.toHaveBeenCalled();
        expect(db.transaction).toHaveBeenCalled();
      });

      it('second partial refund on a legacy partially_refunded parent works', async () => {
        const prior = [{ amount: '-50.00', originalPaymentId: 'pay-001' }];
        const db = buildRefundTxDb(
          partialOriginal,
          prior,
          prior,
          { id: 'refund-2', amount: '-30.00', originalPaymentId: 'pay-001' },
        );
        const svc = await svcWith(db);
        await svc.refundPayment('pay-001', 'prop-001', '30.00');
        expect(mockGateway.refund).toHaveBeenCalled();
      });

      it('final partial refund that closes the gap succeeds', async () => {
        const prior = [
          { amount: '-50.00', originalPaymentId: 'pay-001' },
          { amount: '-30.00', originalPaymentId: 'pay-001' },
        ];
        const db = buildRefundTxDb(
          partialOriginal,
          prior,
          prior,
          { id: 'refund-3', amount: '-20.00', originalPaymentId: 'pay-001' },
        );
        const svc = await svcWith(db);
        await svc.refundPayment('pay-001', 'prop-001', '20.00');
        expect(db.transaction).toHaveBeenCalled();
      });

      it('rejects a refund that would exceed remaining refundable amount', async () => {
        const prior = [{ amount: '-50.00', originalPaymentId: 'pay-001' }];
        const db = buildRefundTxDb(
          partialOriginal,
          prior,
          prior,
          { id: 'unreachable' } as any,
        );
        const svc = await svcWith(db);
        await expect(
          svc.refundPayment('pay-001', 'prop-001', '60.00'),
        ).rejects.toThrow(BadRequestException);
      });

      it('uses a unique idempotency key per partial so Stripe does not dedupe different refunds', async () => {
        const db1 = buildRefundTxDb(
          capturedOriginal,
          [],
          [],
          { id: 'refund-1', amount: '-50.00', originalPaymentId: 'pay-001' },
        );
        const svc1 = await svcWith(db1);
        await svc1.refundPayment('pay-001', 'prop-001', '50.00');
        const key1 = mockGateway.refund.mock.calls[mockGateway.refund.mock.calls.length - 1][2].idempotencyKey;

        const prior = [{ amount: '-50.00', originalPaymentId: 'pay-001' }];
        const db2 = buildRefundTxDb(
          partialOriginal,
          prior,
          prior,
          { id: 'refund-2', amount: '-30.00', originalPaymentId: 'pay-001' },
        );
        const svc2 = await svcWith(db2);
        await svc2.refundPayment('pay-001', 'prop-001', '30.00');
        const key2 = mockGateway.refund.mock.calls[mockGateway.refund.mock.calls.length - 1][2].idempotencyKey;

        expect(key1).not.toBe(key2);
      });

      it('does not re-emit webhook when ledger already reflects the refund', async () => {
        const webhookChild = {
          id: 'refund-webhook',
          amount: '-50.00',
          originalPaymentId: 'pay-001',
          gatewayTransactionId: 'stripe_refund:ch_1:50.00',
        };
        const db = buildRefundTxDb(capturedOriginal, [], [webhookChild], webhookChild);
        const svc = await svcWith(db);
        const result = await svc.refundPayment('pay-001', 'prop-001', '50.00');
        expect(result).toEqual(webhookChild);
        expect(mockWebhookService.emit).not.toHaveBeenCalled();
        expect(mockFolioService.recalculateBalance).not.toHaveBeenCalled();
      });

      it('records only the unrecorded portion when webhook recorded a partial refund', async () => {
        const webhookChild = {
          id: 'refund-webhook',
          amount: '-30.00',
          originalPaymentId: 'pay-001',
          gatewayTransactionId: 'stripe_refund:ch_1:30.00',
        };
        const apiChild = {
          id: 'refund-api',
          amount: '-20.00',
          originalPaymentId: 'pay-001',
          gatewayTransactionId: 'mock-ref-123',
        };
        let insertValues: any;
        let txRound = 0;
        const makeTx = () => {
          txRound++;
          const refundsForTx = txRound === 1 ? [] : [webhookChild];
          let selectCall = 0;
          return {
            select: vi.fn().mockImplementation(() => ({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockImplementation(() => {
                  selectCall++;
                  if (selectCall === 1) {
                    return { for: vi.fn().mockResolvedValue([capturedOriginal]) };
                  }
                  return { then: (resolve: any) => resolve(refundsForTx) };
                }),
              }),
            })),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((vals: any) => {
                insertValues = vals;
                return { returning: vi.fn().mockResolvedValue([apiChild]) };
              }),
            }),
          };
        };
        const db = {
          transaction: vi.fn(async (fn: any) => fn(makeTx())),
          update: vi.fn(),
          delete: vi.fn(),
        };
        const svc = await svcWith(db);
        await svc.refundPayment('pay-001', 'prop-001', '50.00');
        expect(insertValues.amount).toBe('-20.00');
      });
    });
  });
});
