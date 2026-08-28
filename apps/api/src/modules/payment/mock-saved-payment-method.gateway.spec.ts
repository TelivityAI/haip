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
  const provenance = {
    propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
    applicationId: 'submission-attempt-1',
  };

  it('creates a deterministic successful card setup that can be resolved', async () => {
    const gateway = new MockSavedPaymentMethodGateway();

    const first = await gateway.createSetup(
      'guest@example.com',
      'request-card:req_123',
      provenance,
    );
    const retry = await gateway.createSetup(
      'guest@example.com',
      'request-card:req_123',
      provenance,
    );

    expect(retry).toEqual(first);
    await expect(gateway.resolveSetup(first.setupIntentId, provenance)).resolves.toEqual({
      setupIntentId: first.setupIntentId,
      customerId: first.customerId,
      paymentMethodId: expect.stringMatching(/^pm_mock_/),
      cardLastFour: '4242',
      cardBrand: 'visa',
    });
  });

  it('does not resolve a setup identifier it did not create', async () => {
    const gateway = new MockSavedPaymentMethodGateway();

    await expect(gateway.resolveSetup('seti_from_the_browser', provenance)).rejects.toThrow(
      /Unknown mock SetupIntent/,
    );
  });

  it('binds a setup to its property and application provenance', async () => {
    const gateway = new MockSavedPaymentMethodGateway();
    const setup = await gateway.createSetup(
      'guest@example.com',
      'request-card:req_scoped',
      provenance,
    );

    await expect(gateway.resolveSetup(setup.setupIntentId, provenance)).resolves.toMatchObject({
      setupIntentId: setup.setupIntentId,
    });
    await expect(gateway.resolveSetup(setup.setupIntentId, {
      ...provenance,
      propertyId: 'ffffffff-0000-4000-a000-000000000001',
    })).rejects.toThrow(/provenance/i);
    await expect(gateway.resolveSetup(setup.setupIntentId, {
      ...provenance,
      applicationId: 'submission-attempt-2',
    })).rejects.toThrow(/provenance/i);
  });

  it('returns an idempotent successful off-session charge result', async () => {
    const gateway = new MockSavedPaymentMethodGateway();
    const input = {
      customerId: 'cus_mock_trusted',
      paymentMethodId: 'pm_mock_trusted',
      paymentId: 'cccccccc-0000-4000-a000-000000000001',
      propertyId: provenance.propertyId,
      bookingRequestId: 'bbbbbbbb-0000-4000-a000-000000000001',
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

    await expect(gateway.charge({
      ...input,
      paymentId: 'dddddddd-0000-4000-a000-000000000001',
    })).rejects.toThrow(/idempotency.*different.*payment|identity/i);
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

  it.each(['adyen', 'mollie', 'square', 'braintree', 'wise'])(
    'preserves %s startup without constructing a Stripe saved-method adapter',
    (paymentProvider) => {
      const provider = gatewayProvider();
      const alternativeConfig = {
        get: (key: string, fallback?: string) =>
          key === 'PAYMENT_GATEWAY' ? paymentProvider : fallback,
      } as ConfigService;

      expect(() => provider.useFactory(alternativeConfig)).not.toThrow();
    },
  );

  it('rejects every saved-method operation clearly for an unsupported provider', async () => {
    const provider = gatewayProvider();
    const alternativeConfig = {
      get: (key: string, fallback?: string) =>
        key === 'PAYMENT_GATEWAY' ? 'adyen' : fallback,
    } as ConfigService;
    const gateway = provider.useFactory(alternativeConfig);

    const provenance = { propertyId: 'property-test', applicationId: 'application-test' };
    await expect(gateway.createSetup('guest@example.com', 'setup-key', provenance)).rejects.toThrow(
      /Saved payment methods are not supported.*adyen/,
    );
    await expect(gateway.resolveSetup('seti_test', provenance)).rejects.toThrow(
      /Saved payment methods are not supported.*adyen/,
    );
    await expect(gateway.charge({
      customerId: 'cus_test',
      paymentMethodId: 'pm_test',
      paymentId: 'cccccccc-0000-4000-a000-000000000001',
      propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
      bookingRequestId: 'bbbbbbbb-0000-4000-a000-000000000001',
      amount: '10.00',
      currencyCode: 'USD',
      idempotencyKey: 'charge-key',
    })).rejects.toThrow(/Saved payment methods are not supported.*adyen/);
  });
});
