import { MockSavedPaymentMethodGateway } from './mock-saved-payment-method.gateway';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import {
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethodGateway,
} from './interfaces/saved-payment-method-gateway.interface';
import { PaymentModule } from './payment.module';
import { StripeSavedPaymentMethodGateway } from './stripe-saved-payment-method.gateway';

describe('MockSavedPaymentMethodGateway', () => {
  it('creates a deterministic successful card setup that can be resolved', async () => {
    const gateway = new MockSavedPaymentMethodGateway();

    const first = await gateway.createSetup('guest@example.com', 'request-card:req_123');
    const retry = await gateway.createSetup('guest@example.com', 'request-card:req_123');

    expect(retry).toEqual(first);
    await expect(gateway.resolveSetup(first.setupIntentId)).resolves.toEqual({
      setupIntentId: first.setupIntentId,
      customerId: first.customerId,
      paymentMethodId: expect.stringMatching(/^pm_mock_/),
      cardLastFour: '4242',
      cardBrand: 'visa',
    });
  });

  it('does not resolve a setup identifier it did not create', async () => {
    const gateway = new MockSavedPaymentMethodGateway();

    await expect(gateway.resolveSetup('seti_from_the_browser')).rejects.toThrow(
      /Unknown mock SetupIntent/,
    );
  });

  it('returns an idempotent successful off-session charge result', async () => {
    const gateway = new MockSavedPaymentMethodGateway();
    const input = {
      customerId: 'cus_mock_trusted',
      paymentMethodId: 'pm_mock_trusted',
      amount: '75.00',
      currencyCode: 'EUR',
      idempotencyKey: 'request-charge:payment_123',
    };

    const first = await gateway.charge(input);
    const retry = await gateway.charge(input);

    expect(first).toEqual({
      success: true,
      transactionId: expect.stringMatching(/^pi_mock_/),
      requiresAction: false,
    });
    expect(retry).toEqual(first);
  });
});

describe('PaymentModule saved-payment-method registration', () => {
  type GatewayProvider = {
    provide: symbol;
    useFactory: (configService: ConfigService) => SavedPaymentMethodGateway;
  };

  function gatewayProvider(): GatewayProvider {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as unknown[];
    const provider = providers.find(
      (candidate): candidate is GatewayProvider =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'provide' in candidate &&
        candidate.provide === SAVED_PAYMENT_METHOD_GATEWAY,
    );
    if (!provider) throw new Error('Saved payment method provider is not registered');
    return provider;
  }

  it('exports the saved-method injection seam', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, PaymentModule) as unknown[];

    expect(exports).toContain(SAVED_PAYMENT_METHOD_GATEWAY);
  });

  it('selects mock and Stripe adapters without changing the existing gateway', () => {
    const provider = gatewayProvider();
    const mockConfig = {
      get: (key: string, fallback?: string) => key === 'STRIPE_MODE' ? 'mock' : fallback,
    } as ConfigService;
    const stripeConfig = {
      get: (key: string, fallback?: string) => {
        if (key === 'STRIPE_MODE') return 'test';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_saved_method';
        return fallback;
      },
    } as ConfigService;

    expect(provider.useFactory(mockConfig)).toBeInstanceOf(MockSavedPaymentMethodGateway);
    expect(provider.useFactory(stripeConfig)).toBeInstanceOf(StripeSavedPaymentMethodGateway);
  });

  it('honors the existing PAYMENT_GATEWAY override when selecting saved-method mode', () => {
    const provider = gatewayProvider();
    const mockOverride = {
      get: (key: string, fallback?: string) => {
        if (key === 'PAYMENT_GATEWAY') return 'mock';
        if (key === 'STRIPE_MODE') return 'live';
        return fallback;
      },
    } as ConfigService;
    const stripeOverride = {
      get: (key: string, fallback?: string) => {
        if (key === 'PAYMENT_GATEWAY') return 'stripe';
        if (key === 'STRIPE_MODE') return 'mock';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_saved_method';
        return fallback;
      },
    } as ConfigService;

    expect(provider.useFactory(mockOverride)).toBeInstanceOf(MockSavedPaymentMethodGateway);
    expect(provider.useFactory(stripeOverride)).toBeInstanceOf(StripeSavedPaymentMethodGateway);
  });
});
