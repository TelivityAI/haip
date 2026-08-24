import type { ConfigService } from '@nestjs/config';
import { StripeSavedPaymentMethodGateway } from './stripe-saved-payment-method.gateway';

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    customers: {
      create: vi.fn(),
    },
    setupIntents: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
    paymentMethods: {
      retrieve: vi.fn(),
    },
    paymentIntents: {
      create: vi.fn(),
    },
  })),
}));

function config(secretKey = 'sk_test_saved_method'): ConfigService {
  return {
    get: vi.fn((key: string) => key === 'STRIPE_SECRET_KEY' ? secretKey : undefined),
  } as unknown as ConfigService;
}

describe('StripeSavedPaymentMethodGateway', () => {
  let gateway: StripeSavedPaymentMethodGateway;
  let stripe: {
    customers: { create: ReturnType<typeof vi.fn> };
    setupIntents: {
      create: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
    };
    paymentMethods: { retrieve: ReturnType<typeof vi.fn> };
    paymentIntents: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new StripeSavedPaymentMethodGateway(config());
    stripe = (gateway as unknown as { stripe: typeof stripe }).stripe;
  });

  it('requires a Stripe secret key', () => {
    expect(() => new StripeSavedPaymentMethodGateway(config(''))).toThrow(
      /STRIPE_SECRET_KEY is required/,
    );
  });

  it('creates an off-session card setup for a new customer idempotently', async () => {
    stripe.customers.create.mockResolvedValue({ id: 'cus_trusted' });
    stripe.setupIntents.create.mockResolvedValue({
      id: 'seti_trusted',
      client_secret: 'seti_secret_safe_for_guest',
    });

    await expect(
      gateway.createSetup('guest@example.com', 'request-card:req_123'),
    ).resolves.toEqual({
      setupIntentId: 'seti_trusted',
      clientSecret: 'seti_secret_safe_for_guest',
      customerId: 'cus_trusted',
    });
    expect(stripe.customers.create).toHaveBeenCalledWith(
      { email: 'guest@example.com' },
      { idempotencyKey: 'request-card:req_123' },
    );
    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      {
        customer: 'cus_trusted',
        usage: 'off_session',
        payment_method_types: ['card'],
      },
      { idempotencyKey: 'request-card:req_123' },
    );
  });

  it('rejects setup resolution unless Stripe reports success', async () => {
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: 'seti_unconfirmed',
      status: 'requires_payment_method',
      customer: 'cus_untrusted',
      payment_method: 'pm_untrusted',
    });

    await expect(gateway.resolveSetup('seti_unconfirmed')).rejects.toThrow(
      /has not succeeded/,
    );
    expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
  });

  it('returns only trusted Stripe IDs and safe card display metadata', async () => {
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: 'seti_trusted',
      status: 'succeeded',
      customer: 'cus_trusted',
      payment_method: 'pm_trusted',
    });
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: 'pm_trusted',
      type: 'card',
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2035,
        fingerprint: 'server-only-fingerprint',
      },
    });

    const result = await gateway.resolveSetup('seti_trusted');

    expect(stripe.setupIntents.retrieve).toHaveBeenCalledWith('seti_trusted');
    expect(stripe.paymentMethods.retrieve).toHaveBeenCalledWith('pm_trusted');
    expect(result).toEqual({
      setupIntentId: 'seti_trusted',
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      cardLastFour: '4242',
      cardBrand: 'visa',
    });
    expect(result).not.toHaveProperty('fingerprint');
    expect(result).not.toHaveProperty('clientSecret');
  });

  it('rejects a succeeded setup that does not resolve to a card', async () => {
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: 'seti_bank',
      status: 'succeeded',
      customer: 'cus_trusted',
      payment_method: 'pm_bank',
    });
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: 'pm_bank',
      type: 'us_bank_account',
      card: null,
    });

    await expect(gateway.resolveSetup('seti_bank')).rejects.toThrow(/card payment method/);
  });

  it('confirms an off-session PaymentIntent with automatic capture and idempotency', async () => {
    stripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_captured',
      status: 'succeeded',
    });

    await expect(gateway.charge({
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      amount: '123.45',
      currencyCode: 'EUR',
      idempotencyKey: 'request-charge:payment_123',
    })).resolves.toEqual({
      success: true,
      transactionId: 'pi_captured',
      requiresAction: false,
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 12345,
        currency: 'eur',
        customer: 'cus_trusted',
        payment_method: 'pm_trusted',
        confirm: true,
        off_session: true,
        capture_method: 'automatic',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
      },
      { idempotencyKey: 'request-charge:payment_123' },
    );
  });

  it('maps additional authentication to a failed charge with no recovery secret', async () => {
    stripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_requires_action',
      status: 'requires_action',
      client_secret: 'must_not_leave_gateway',
    });

    const result = await gateway.charge({
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      amount: '40.00',
      currencyCode: 'USD',
      idempotencyKey: 'request-charge:payment_action',
    });

    expect(result).toEqual({
      success: false,
      transactionId: 'pi_requires_action',
      requiresAction: true,
      errorMessage: 'Payment requires additional authentication',
    });
    expect(result).not.toHaveProperty('clientSecret');
    expect(result).not.toHaveProperty('authenticationUrl');
  });

  it('maps Stripe off-session authentication errors to the same terminal failure', async () => {
    stripe.paymentIntents.create.mockRejectedValue({
      message: 'This payment requires authentication',
      payment_intent: {
        id: 'pi_error_requires_action',
        status: 'requires_action',
        client_secret: 'must_not_leave_gateway',
      },
    });

    await expect(gateway.charge({
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      amount: '40.00',
      currencyCode: 'USD',
      idempotencyKey: 'request-charge:payment_error_action',
    })).resolves.toEqual({
      success: false,
      transactionId: 'pi_error_requires_action',
      requiresAction: true,
      errorMessage: 'Payment requires additional authentication',
    });
  });
});
