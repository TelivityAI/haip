import { ConfigService } from '@nestjs/config';
import { WorldlineGateway } from './worldline-gateway';

const CREDS = {
  merchantId: 'psp-1',
  apiKeyId: 'key-1',
  secretApiKey: 'secret-1',
  environment: 'test' as const,
};

function config(entries: Record<string, string | undefined> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      entries[key] !== undefined ? entries[key] : defaultValue,
  } as ConfigService;
}

function sdk() {
  return {
    hostedCheckout: {
      createHostedCheckout: vi.fn(),
      getHostedCheckout: vi.fn(),
    },
    payments: {
      capturePayment: vi.fn(),
      cancelPayment: vi.fn(),
      refundPayment: vi.fn(),
    },
  };
}

describe('WorldlineGateway', () => {
  it('fails closed when merchant credentials are missing', async () => {
    const clientFactory = vi.fn();
    const gateway = new WorldlineGateway(config(), { clientFactory });
    const result = await gateway.authorize('worldline_hosted', 10, 'EUR', {
      redirect: { merchantUrl: '', urlOk: 'https://hotel.example/return', urlKo: 'https://hotel.example/return' },
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/credentials/i);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('creates a pre-authorization hosted checkout and returns a GET redirect', async () => {
    const client = sdk();
    client.hostedCheckout.createHostedCheckout.mockResolvedValue({
      isSuccess: true,
      body: {
        hostedCheckoutId: 'hc-1',
        redirectUrl: 'https://payment.preprod.direct.worldline-solutions.com/checkout/hc-1',
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const result = await gateway.authorize('worldline_hosted', 29.8, 'eur', {
      worldlineCredentials: CREDS,
      idempotencyKey: 'auth-1',
      redirect: { merchantUrl: '', urlOk: 'https://hotel.example/return', urlKo: 'https://hotel.example/return', returnUrl: 'https://hotel.example/return' },
    });

    expect(result).toEqual({
      success: true,
      transactionId: 'hc-1',
      providerStatus: 'requires_action',
      nextAction: {
        type: 'redirect',
        method: 'GET',
        url: 'https://payment.preprod.direct.worldline-solutions.com/checkout/hc-1',
        formFields: {},
      },
    });
    expect(client.hostedCheckout.createHostedCheckout).toHaveBeenCalledWith(
      'psp-1',
      {
        order: { amountOfMoney: { currencyCode: 'EUR', amount: 2980 } },
        cardPaymentMethodSpecificInput: { authorizationMode: 'PRE_AUTHORIZATION' },
        redirectPaymentMethodSpecificInput: { requiresApproval: true },
        hostedCheckoutSpecificInput: { returnUrl: 'https://hotel.example/return' },
      },
      { idempotence: { key: 'auth-1' } },
    );
  });

  it('builds a redirect from partialRedirectUrl when the full URL is absent', async () => {
    const client = sdk();
    client.hostedCheckout.createHostedCheckout.mockResolvedValue({
      isSuccess: true,
      body: { hostedCheckoutId: 'hc-2', partialRedirectUrl: 'preprod.direct.worldline-solutions.com/checkout/hc-2' },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const result = await gateway.authorize('worldline_hosted', 1, 'EUR', {
      worldlineCredentials: CREDS,
      redirect: { merchantUrl: '', urlOk: 'https://hotel.example/ok', urlKo: 'https://hotel.example/ok' },
    });
    expect(result.nextAction?.url).toBe('https://payment.preprod.direct.worldline-solutions.com/checkout/hc-2');
  });

  it('captures, cancels, and refunds against the payment id', async () => {
    const client = sdk();
    client.payments.capturePayment.mockResolvedValue({ isSuccess: true, body: { id: 'cap-1' } });
    client.payments.cancelPayment.mockResolvedValue({ isSuccess: true, body: {} });
    client.payments.refundPayment.mockResolvedValue({ isSuccess: true, body: { id: 'ref-1' } });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const options = { worldlineCredentials: CREDS, currencyCode: 'EUR', authorizedAmount: 10 };

    await expect(gateway.capture('pay-1', 10, options)).resolves.toMatchObject({ success: true, transactionId: 'cap-1' });
    expect(client.payments.capturePayment).toHaveBeenCalledWith(
      'psp-1',
      'pay-1',
      { amount: 1000, isFinal: true },
      {},
    );

    await expect(gateway.capture('pay-1', 4, options)).resolves.toMatchObject({ success: true });
    expect(client.payments.capturePayment).toHaveBeenLastCalledWith(
      'psp-1',
      'pay-1',
      { amount: 400, isFinal: false },
      {},
    );

    await expect(gateway.void('pay-1', options)).resolves.toMatchObject({ success: true });
    expect(client.payments.cancelPayment).toHaveBeenCalledWith(
      'psp-1',
      'pay-1',
      { isFinal: true, amountOfMoney: { amount: 1000, currencyCode: 'EUR' } },
      {},
    );

    await expect(gateway.refund('pay-1', 2.5, options)).resolves.toMatchObject({ success: true, transactionId: 'ref-1' });
    expect(client.payments.refundPayment).toHaveBeenCalledWith(
      'psp-1',
      'pay-1',
      { amountOfMoney: { amount: 250, currencyCode: 'EUR' } },
      {},
    );
  });

  it('reads hosted checkout status without treating a transport error as a decline', async () => {
    const client = sdk();
    client.hostedCheckout.getHostedCheckout
      .mockResolvedValueOnce({
        isSuccess: true,
        body: {
          status: 'PAYMENT_CREATED',
          createdPaymentOutput: {
            payment: { id: 'pay-9', status: 'PENDING_CAPTURE', statusOutput: { statusCode: 5, isAuthorized: true } },
          },
        },
      })
      .mockRejectedValueOnce(new Error('network'));
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readHostedCheckout('hc-9', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'authorized',
      paymentId: 'pay-9',
    });
    await expect(gateway.readHostedCheckout('hc-9', { worldlineCredentials: CREDS })).resolves.toMatchObject({
      outcome: 'pending',
    });
  });
});
