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
  const provenance = {
    propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
    applicationId: 'submission-attempt-1',
  };

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
      gateway.createSetup(
        'guest@example.com',
        'request-card:req_123',
        provenance,
      ),
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
        metadata: {
          haip_property_id: provenance.propertyId,
          haip_application_hash:
            'cf18a22e39cd5bba19be060f31c6a9e68094cefbaf2c4a23c5738bf78c687a3a',
        },
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

    await expect(gateway.resolveSetup('seti_unconfirmed', provenance)).rejects.toThrow(
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
      metadata: {
        haip_property_id: provenance.propertyId,
        haip_application_hash:
          'cf18a22e39cd5bba19be060f31c6a9e68094cefbaf2c4a23c5738bf78c687a3a',
      },
    });
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: 'pm_trusted',
      type: 'card',
      customer: { id: 'cus_trusted' },
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2035,
        fingerprint: 'server-only-fingerprint',
      },
    });

    const result = await gateway.resolveSetup('seti_trusted', provenance);

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
      metadata: {
        haip_property_id: provenance.propertyId,
        haip_application_hash:
          'cf18a22e39cd5bba19be060f31c6a9e68094cefbaf2c4a23c5738bf78c687a3a',
      },
    });
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: 'pm_bank',
      type: 'us_bank_account',
      customer: 'cus_trusted',
      card: null,
    });

    await expect(
      gateway.resolveSetup('seti_bank', provenance),
    ).rejects.toThrow(/card payment method/);
  });

  it('rejects a successful SetupIntent issued for another property or application', async () => {
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: 'seti_wrong_scope',
      status: 'succeeded',
      customer: 'cus_trusted',
      payment_method: 'pm_trusted',
      metadata: {
        haip_property_id: provenance.propertyId,
        haip_application_hash:
          'cf18a22e39cd5bba19be060f31c6a9e68094cefbaf2c4a23c5738bf78c687a3a',
      },
    });

    await expect(gateway.resolveSetup('seti_wrong_scope', {
      ...provenance,
      propertyId: 'ffffffff-0000-4000-a000-000000000001',
    })).rejects.toThrow(/provenance/i);
    await expect(gateway.resolveSetup('seti_wrong_scope', {
      ...provenance,
      applicationId: 'submission-attempt-2',
    })).rejects.toThrow(/provenance/i);
    expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
  });

  it('rejects a PaymentMethod attached to a different Stripe customer', async () => {
    stripe.setupIntents.retrieve.mockResolvedValue({
      id: 'seti_mismatch',
      status: 'succeeded',
      customer: 'cus_setup_owner',
      payment_method: 'pm_mismatched',
      metadata: {
        haip_property_id: provenance.propertyId,
        haip_application_hash:
          'cf18a22e39cd5bba19be060f31c6a9e68094cefbaf2c4a23c5738bf78c687a3a',
      },
    });
    stripe.paymentMethods.retrieve.mockResolvedValue({
      id: 'pm_mismatched',
      type: 'card',
      customer: { id: 'cus_different_owner' },
      card: {
        brand: 'visa',
        last4: '4242',
      },
    });

    await expect(gateway.resolveSetup('seti_mismatch', provenance)).rejects.toThrow(
      /PaymentMethod.*does not belong.*cus_setup_owner/,
    );
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

  it.each([
    { currencyCode: 'JPY', amount: '123', expectedMinorUnits: 123 },
    { currencyCode: 'BHD', amount: '1.234', expectedMinorUnits: 1234 },
  ])(
    'uses the ISO-4217 exponent for $currencyCode without losing Decimal exactness',
    async ({ currencyCode, amount, expectedMinorUnits }) => {
      stripe.paymentIntents.create.mockResolvedValue({
        id: `pi_${currencyCode.toLowerCase()}`,
        status: 'succeeded',
      });

      const result = await gateway.charge({
        customerId: 'cus_trusted',
        paymentMethodId: 'pm_trusted',
        amount,
        currencyCode,
        idempotencyKey: `request-charge:${currencyCode}`,
      });

      expect(result.success).toBe(true);
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: expectedMinorUnits }),
        { idempotencyKey: `request-charge:${currencyCode}` },
      );
    },
  );

  it.each([
    { currencyCode: 'JPY', amount: '1.5' },
    { currencyCode: 'USD', amount: '1.001' },
    { currencyCode: 'BHD', amount: '1.2345' },
  ])(
    'rejects $amount $currencyCode instead of rounding a fractional minor unit',
    async ({ currencyCode, amount }) => {
      const result = await gateway.charge({
        customerId: 'cus_trusted',
        paymentMethodId: 'pm_trusted',
        amount,
        currencyCode,
        idempotencyKey: `request-charge:fractional-${currencyCode}`,
      });

      expect(result).toEqual({
        success: false,
        transactionId: '',
        requiresAction: false,
        errorMessage: expect.stringMatching(/fractional minor units/),
      });
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown currency code before calling Stripe', async () => {
    const result = await gateway.charge({
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      amount: '10.00',
      currencyCode: 'ZZZ',
      idempotencyKey: 'request-charge:unknown-currency',
    });

    expect(result).toEqual({
      success: false,
      transactionId: '',
      requiresAction: false,
      errorMessage: "Unsupported ISO-4217 currency code 'ZZZ'",
    });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
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

  it('propagates a transport error so the durable payment claim remains retryable', async () => {
    stripe.paymentIntents.create.mockRejectedValue(new Error('connection reset after write'));

    await expect(gateway.charge({
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      amount: '40.00',
      currencyCode: 'USD',
      idempotencyKey: 'request-charge:transport-error',
    })).rejects.toThrow(/connection reset/i);
  });

  it('maps an explicit Stripe card decline to a terminal failure', async () => {
    stripe.paymentIntents.create.mockRejectedValue({
      type: 'StripeCardError',
      message: 'Your card was declined',
      payment_intent: {
        id: 'pi_declined',
        status: 'requires_payment_method',
      },
    });

    await expect(gateway.charge({
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      amount: '40.00',
      currencyCode: 'USD',
      idempotencyKey: 'request-charge:declined',
    })).resolves.toEqual({
      success: false,
      transactionId: 'pi_declined',
      requiresAction: false,
      errorMessage: 'Your card was declined',
    });
  });
});
