import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeWebhookController } from './stripe-webhook.controller';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { DRIZZLE } from '../../database/database.module';
import {
  bookingRequests,
  bookingRequestPaymentResolutions,
  payments,
} from '@telivityhaip/database';
import { reconcileBookingRequestPaymentAllocations } from '../booking-request/booking-request-allocation-reconciler';

vi.mock('../booking-request/booking-request-allocation-reconciler', () => ({
  reconcileBookingRequestPaymentAllocations: vi.fn().mockResolvedValue(undefined),
}));

const mockPayment = {
  id: 'pay-001',
  propertyId: 'prop-001',
  folioId: 'folio-001',
  status: 'authorized',
  amount: '500.00',
  currencyCode: 'USD',
  gatewayTransactionId: 'pi_test_123',
};

function createRefundWebhookDb(
  payment: any,
  existingRefunds: any[] = [],
  existingForLedger: any[] = [],
  pendingResolutions: any[] = [],
) {
  let insertedValues: Record<string, unknown> | undefined;
  let resolutionValues: Record<string, unknown> | undefined;
  let resolutionUpdate: Record<string, unknown> | undefined;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([payment]),
        }),
      }),
    })),
    transaction: vi.fn(async (fn: any) => {
      let selectCall = 0;
      const tx = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn((table: unknown) => ({
            where: vi.fn().mockImplementation(() => {
              if (table === bookingRequests) {
                return { for: vi.fn().mockResolvedValue([{
                  id: payment.bookingRequestId,
                  propertyId: payment.propertyId,
                }]) };
              }
              if (table === bookingRequestPaymentResolutions) {
                return { for: vi.fn().mockResolvedValue(pendingResolutions) };
              }
              selectCall++;
              if (selectCall === 1) {
                return { for: vi.fn().mockResolvedValue([payment]) };
              }
              if (selectCall === 2) {
                return {
                  limit: vi.fn().mockReturnValue({
                    then: (resolve: any) => resolve(existingForLedger),
                  }),
                };
              }
              return { then: (resolve: any) => resolve(existingRefunds) };
            }),
          })),
        })),
        insert: vi.fn((table: unknown) => ({
          values: vi.fn((values: Record<string, unknown>) => {
            if (table === payments) insertedValues = values;
            if (table === bookingRequestPaymentResolutions) resolutionValues = values;
            return {
              returning: vi.fn().mockResolvedValue([
                table === payments
                  ? {
                    id: 'refund-webhook-1',
                    folioId: payment.folioId,
                    bookingRequestId: payment.bookingRequestId,
                    originalPaymentId: payment.id,
                  }
                  : { id: 'resolution-webhook-1', ...values },
              ]),
            };
          }),
        })),
        update: vi.fn((table: unknown) => ({
          set: vi.fn((values: Record<string, unknown>) => {
            if (table === bookingRequestPaymentResolutions) resolutionUpdate = values;
            return { where: vi.fn().mockResolvedValue(undefined) };
          }),
        })),
      };
      return fn(tx);
    }),
    update: vi.fn(),
    getInsertedValues: () => insertedValues,
    getResolutionValues: () => resolutionValues,
    getResolutionUpdate: () => resolutionUpdate,
  };
}

function createMockDb(returnData: any[] = [mockPayment]) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve(returnData),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnData),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(returnData),
        }),
      }),
    }),
  };
}

const mockWebhookService = { emit: vi.fn() };
const mockFolioService = { recalculateBalance: vi.fn().mockResolvedValue(undefined) };
const mockConfigService = {
  get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
    if (key === 'STRIPE_MODE') return 'mock';
    if (key === 'STRIPE_SECRET_KEY') return null;
    if (key === 'STRIPE_WEBHOOK_SECRET') return null;
    return defaultValue;
  }),
};

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        { provide: DRIZZLE, useValue: mockDb },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
  });

  describe('handleWebhook (mock mode)', () => {
    it('should return 200 with mode: mock when STRIPE_MODE=mock', async () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await controller.handleWebhook({}, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ received: true, mode: 'mock' });
    });
  });

  describe('internal handlers', () => {
    it('should update payment to captured on payment_intent.succeeded', async () => {
      const handler = (controller as any).handlePaymentIntentSucceeded.bind(controller);
      await handler({ id: 'pi_test_123' });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.received',
        'payment',
        'pay-001',
        expect.objectContaining({ status: 'captured' }),
        'prop-001',
      );
    });

    it('does not recalculate a missing folio for a pre-acceptance request payment', async () => {
      const requestDb = createMockDb([{
        ...mockPayment,
        folioId: null,
        bookingRequestId: 'request-001',
      }]);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: requestDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await (module.get(StripeWebhookController) as any)
        .handlePaymentIntentSucceeded({ id: 'pi_test_123' });

      expect(requestDb.update).toHaveBeenCalled();
      expect(mockFolioService.recalculateBalance).not.toHaveBeenCalled();
    });

    it('should skip if payment already captured', async () => {
      const capturedDb = createMockDb([{ ...mockPayment, status: 'captured' }]);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const ctrl = module.get<StripeWebhookController>(StripeWebhookController);

      await (ctrl as any).handlePaymentIntentSucceeded({ id: 'pi_test_123' });

      expect(capturedDb.update).not.toHaveBeenCalled();
    });

    it('should update payment to failed on payment_intent.payment_failed', async () => {
      const handler = (controller as any).handlePaymentIntentFailed.bind(controller);
      await handler({
        id: 'pi_test_123',
        last_payment_error: { message: 'Card declined' },
      });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.failed',
        'payment',
        'pay-001',
        expect.objectContaining({ error: 'Card declined' }),
        'prop-001',
      );
    });

    it('should update payment to voided on payment_intent.canceled', async () => {
      const handler = (controller as any).handlePaymentIntentCanceled.bind(controller);
      await handler({ id: 'pi_test_123' });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.failed',
        'payment',
        'pay-001',
        expect.objectContaining({ status: 'voided' }),
        'prop-001',
      );
    });

    it('should insert a refund child on charge.refunded (full)', async () => {
      const capturedDb = createRefundWebhookDb({ ...mockPayment, status: 'captured', method: 'credit_card' });
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const ctrl = module.get<StripeWebhookController>(StripeWebhookController);

      await (ctrl as any).handleChargeRefunded({
        id: 'ch_test_123',
        payment_intent: 'pi_test_123',
        amount: 50000,
        amount_refunded: 50000,
      });

      expect(capturedDb.transaction).toHaveBeenCalled();
      expect(capturedDb.update).not.toHaveBeenCalled();
      expect(mockFolioService.recalculateBalance).toHaveBeenCalledWith(
        'folio-001',
        'prop-001',
        expect.anything(),
      );
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.refunded',
        'payment',
        'refund-webhook-1',
        expect.objectContaining({ refundAmount: '500.00', originalPaymentId: 'pay-001' }),
        'prop-001',
      );
    });

    it('should insert a partial refund child on charge.refunded', async () => {
      const capturedDb = createRefundWebhookDb({ ...mockPayment, status: 'captured', method: 'credit_card' });
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const ctrl = module.get<StripeWebhookController>(StripeWebhookController);

      await (ctrl as any).handleChargeRefunded({
        id: 'ch_test_123',
        payment_intent: 'pi_test_123',
        amount: 50000,
        amount_refunded: 25000,
      });

      expect(capturedDb.transaction).toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'payment.refunded',
        'payment',
        'refund-webhook-1',
        expect.objectContaining({ refundAmount: '250.00' }),
        'prop-001',
      );
    });

    it('converts Stripe refunds with the currency minor-unit exponent', async () => {
      const jpyPayment = {
        ...mockPayment,
        status: 'captured',
        method: 'credit_card',
        amount: '500.00',
        currencyCode: 'JPY',
      };
      const capturedDb = createRefundWebhookDb(jpyPayment);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await (module.get(StripeWebhookController) as any).handleChargeRefunded({
        id: 'ch_jpy_123',
        payment_intent: 'pi_test_123',
        amount: 500,
        amount_refunded: 500,
        currency: 'jpy',
      });

      expect(capturedDb.getInsertedValues()).toEqual(expect.objectContaining({
        amount: '-500.00',
        currencyCode: 'JPY',
      }));
    });

    it('fails visibly instead of acknowledging a scale-three currency refund', async () => {
      const capturedDb = createRefundWebhookDb({
        ...mockPayment,
        status: 'captured',
        method: 'credit_card',
        amount: '1.00',
        currencyCode: 'BHD',
      });
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await expect((module.get(StripeWebhookController) as any).handleChargeRefunded({
        id: 'ch_bhd_123',
        payment_intent: 'pi_test_123',
        amount: 1000,
        amount_refunded: 1000,
        currency: 'bhd',
      })).rejects.toThrow(/ledger.*precision|unsupported.*BHD/i);
      expect(capturedDb.transaction).not.toHaveBeenCalled();
    });

    it('preserves request provenance on a pre-acceptance refund webhook', async () => {
      const capturedDb = createRefundWebhookDb({
        ...mockPayment,
        folioId: null,
        bookingRequestId: 'request-001',
        status: 'captured',
        method: 'credit_card',
      });
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await (module.get(StripeWebhookController) as any).handleChargeRefunded({
        id: 'ch_request_123',
        payment_intent: 'pi_test_123',
        amount: 50000,
        amount_refunded: 25000,
      });

      expect(capturedDb.getInsertedValues()).toEqual(expect.objectContaining({
        bookingRequestId: 'request-001',
        folioId: null,
        originalPaymentId: 'pay-001',
      }));
      expect(capturedDb.getResolutionValues()).toEqual(expect.objectContaining({
        propertyId: 'prop-001',
        bookingRequestId: 'request-001',
        paymentId: 'pay-001',
        type: 'refund',
        amount: '250.00',
      }));
      expect(mockFolioService.recalculateBalance).not.toHaveBeenCalled();
    });

    it('reconciles request allocations inside the refund ledger transaction', async () => {
      const requestPayment = {
        ...mockPayment,
        bookingRequestId: 'request-001',
        status: 'captured',
        method: 'credit_card',
      };
      const capturedDb = createRefundWebhookDb(requestPayment);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await (module.get(StripeWebhookController) as any).handleChargeRefunded({
        id: 'ch_allocated',
        payment_intent: 'pi_test_123',
        amount: 50000,
        amount_refunded: 25000,
      });

      expect(reconcileBookingRequestPaymentAllocations).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bookingRequestId: 'request-001',
          propertyId: 'prop-001',
          payment: expect.objectContaining({ id: 'pay-001' }),
        }),
      );
    });

    it('completes a matching pending refund claim instead of double-resolving it', async () => {
      const requestPayment = {
        ...mockPayment,
        bookingRequestId: 'request-001',
        status: 'captured',
        method: 'credit_card',
      };
      const capturedDb = createRefundWebhookDb(requestPayment, [], [], [{
        id: 'pending-resolution-1',
        propertyId: 'prop-001',
        bookingRequestId: 'request-001',
        paymentId: 'pay-001',
        type: 'refund',
        status: 'pending',
        amount: '25.00',
        attempts: 1,
      }]);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await (module.get(StripeWebhookController) as any).handleChargeRefunded({
        id: 'ch_pending_claim',
        payment_intent: 'pi_test_123',
        amount: 50000,
        amount_refunded: 2500,
      });

      expect(capturedDb.getResolutionValues()).toBeUndefined();
      expect(capturedDb.getResolutionUpdate()).toEqual(expect.objectContaining({
        status: 'completed',
        movementId: 'refund-webhook-1',
      }));
    });

    it('repairs allocation and folio consequences when a refund webhook is replayed', async () => {
      const requestPayment = {
        ...mockPayment,
        bookingRequestId: 'request-001',
        status: 'captured',
        method: 'credit_card',
      };
      const capturedDb = createRefundWebhookDb(requestPayment, [], [{
        id: 'refund-webhook-existing',
        folioId: 'folio-001',
        bookingRequestId: 'request-001',
        originalPaymentId: 'pay-001',
      }]);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: capturedDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      await (module.get(StripeWebhookController) as any).handleChargeRefunded({
        id: 'ch_replayed',
        payment_intent: 'pi_test_123',
        amount: 50000,
        amount_refunded: 25000,
      });

      expect(reconcileBookingRequestPaymentAllocations).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ payment: expect.objectContaining({ id: 'pay-001' }) }),
      );
      expect(mockFolioService.recalculateBalance).toHaveBeenCalledWith(
        'folio-001',
        'prop-001',
        expect.anything(),
      );
    });

    it('should not update if payment not found', async () => {
      const emptyDb = createMockDb([]);
      const module = await Test.createTestingModule({
        controllers: [StripeWebhookController],
        providers: [
          { provide: DRIZZLE, useValue: emptyDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: FolioService, useValue: mockFolioService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const ctrl = module.get<StripeWebhookController>(StripeWebhookController);

      await (ctrl as any).handlePaymentIntentSucceeded({ id: 'pi_unknown' });

      expect(emptyDb.update).not.toHaveBeenCalled();
    });
  });
});
