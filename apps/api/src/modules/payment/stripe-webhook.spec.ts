import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeWebhookController } from './stripe-webhook.controller';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { DRIZZLE } from '../../database/database.module';

const mockPayment = {
  id: 'pay-001',
  propertyId: 'prop-001',
  folioId: 'folio-001',
  status: 'authorized',
  amount: '500.00',
  gatewayTransactionId: 'pi_test_123',
};

function createRefundWebhookDb(
  payment: any,
  existingRefunds: any[] = [],
  existingForLedger: any[] = [],
) {
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
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
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
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: 'refund-webhook-1', folioId: payment.folioId, originalPaymentId: payment.id },
            ]),
          }),
        }),
      };
      return fn(tx);
    }),
    update: vi.fn(),
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
