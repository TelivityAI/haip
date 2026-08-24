import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeGateway } from './stripe-gateway';

// Mock the Stripe SDK
vi.mock('stripe', () => {
  const mockPaymentIntents = {
    create: vi.fn(),
    capture: vi.fn(),
    cancel: vi.fn(),
  };
  const mockRefunds = {
    create: vi.fn(),
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      paymentIntents: mockPaymentIntents,
      refunds: mockRefunds,
    })),
  };
});

function createMockConfigService(secretKey = 'sk_test_mock_key_123') {
  return {
    get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'STRIPE_SECRET_KEY') return secretKey;
      return defaultValue;
    }),
  };
}

describe('StripeGateway', () => {
  let gateway: StripeGateway;
  let stripeInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeGateway,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    gateway = module.get<StripeGateway>(StripeGateway);
    // Get the mocked Stripe instance
    stripeInstance = (gateway as any).stripe;
  });

  it('should throw if STRIPE_SECRET_KEY is not set', () => {
    expect(() => {
      new StripeGateway({ get: () => undefined } as any);
    }).toThrow('STRIPE_SECRET_KEY is required');
  });

  describe('authorize', () => {
    it('should create PaymentIntent with manual capture', async () => {
      stripeInstance.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        status: 'requires_capture',
      });

      const result = await gateway.authorize('pm_card_visa', 150.00, 'USD');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('pi_test_123');
      expect(stripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 15000, // cents
          currency: 'usd',
          payment_method: 'pm_card_visa',
          capture_method: 'manual',
          confirm: true,
        }),
        undefined,
      );
    });

    it('should convert amount to cents (Stripe requirement)', async () => {
      stripeInstance.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_456',
        status: 'requires_capture',
      });

      await gateway.authorize('pm_test', 299.99, 'EUR');

      expect(stripeInstance.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 29999 }),
        undefined,
      );
    });

    it('should return failure for unexpected status', async () => {
      stripeInstance.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_789',
        status: 'requires_action', // 3DS needed
      });

      const result = await gateway.authorize('pm_test', 100, 'USD');

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('requires_action');
    });

    it('should handle Stripe API errors gracefully', async () => {
      stripeInstance.paymentIntents.create.mockRejectedValue(
        new Error('Your card was declined.'),
      );

      const result = await gateway.authorize('pm_declined', 100, 'USD');

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('declined');
    });
  });

  describe('capture', () => {
    it('should capture a PaymentIntent', async () => {
      stripeInstance.paymentIntents.capture.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
      });

      const result = await gateway.capture('pi_test_123');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('pi_test_123');
      expect(stripeInstance.paymentIntents.capture).toHaveBeenCalledWith('pi_test_123', {}, undefined);
    });

    it('should support partial capture with amount', async () => {
      stripeInstance.paymentIntents.capture.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
      });

      await gateway.capture('pi_test_123', 75.50);

      expect(stripeInstance.paymentIntents.capture).toHaveBeenCalledWith('pi_test_123', {
        amount_to_capture: 7550,
      }, undefined);
    });

    it('should handle capture failure', async () => {
      stripeInstance.paymentIntents.capture.mockRejectedValue(
        new Error('PaymentIntent has already been captured'),
      );

      const result = await gateway.capture('pi_test_123');

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('already been captured');
    });
  });

  describe('void', () => {
    it('should cancel a PaymentIntent', async () => {
      stripeInstance.paymentIntents.cancel.mockResolvedValue({
        id: 'pi_test_123',
        status: 'canceled',
      });

      const result = await gateway.void('pi_test_123');

      expect(result.success).toBe(true);
      expect(stripeInstance.paymentIntents.cancel).toHaveBeenCalledWith('pi_test_123', undefined, undefined);
    });

    it('should handle void failure', async () => {
      stripeInstance.paymentIntents.cancel.mockRejectedValue(
        new Error('PaymentIntent has already been canceled'),
      );

      const result = await gateway.void('pi_test_123');

      expect(result.success).toBe(false);
    });
  });

  describe('refund', () => {
    it('should create a full refund', async () => {
      stripeInstance.refunds.create.mockResolvedValue({
        id: 're_test_123',
        status: 'succeeded',
      });

      const result = await gateway.refund('pi_test_123');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('re_test_123');
      expect(stripeInstance.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_test_123',
      }, undefined);
    });

    it('should create a partial refund with amount in cents', async () => {
      stripeInstance.refunds.create.mockResolvedValue({
        id: 're_test_456',
        status: 'succeeded',
      });

      await gateway.refund('pi_test_123', 50.00);

      expect(stripeInstance.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_test_123',
        amount: 5000,
      }, undefined);
    });

    it('uses the ISO currency exponent for a JPY partial refund', async () => {
      stripeInstance.refunds.create.mockResolvedValue({
        id: 're_jpy',
        status: 'succeeded',
      });

      await gateway.refund('pi_jpy', 51, { currencyCode: 'JPY' });

      expect(stripeInstance.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_jpy',
        amount: 51,
      }, undefined);
    });

    it('rejects a currency beyond ledger precision before calling Stripe', async () => {
      const result = await gateway.refund('pi_bhd', 1, { currencyCode: 'BHD' });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/ledger.*precision/i);
      expect(stripeInstance.refunds.create).not.toHaveBeenCalled();
    });

    it('should handle refund failure', async () => {
      stripeInstance.refunds.create.mockRejectedValue({
        type: 'StripeInvalidRequestError',
        message: 'Charge has already been refunded',
      });

      const result = await gateway.refund('pi_test_123');

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('already been refunded');
    });

    it('propagates an unknown transport result for durable same-key retry', async () => {
      stripeInstance.refunds.create.mockRejectedValue(
        new Error('connection reset after refund submission'),
      );

      await expect(gateway.refund(
        'pi_test_123',
        50,
        { idempotencyKey: 'refund-same-key', currencyCode: 'USD' },
      )).rejects.toThrow(/connection reset/i);
    });
  });
});
