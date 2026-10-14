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
      createPayment: vi.fn(),
      getPayment: vi.fn(),
      getPaymentDetails: vi.fn(),
    },
    hostedTokenization: {
      createHostedTokenization: vi.fn(),
    },
  };
}

const REDIRECT = {
  merchantUrl: '',
  urlOk: 'https://hotel.example/return',
  urlKo: 'https://hotel.example/return',
  returnUrl: 'https://hotel.example/return',
};

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

  it('leaves an authorized-looking checkout pending until a payment id exists', async () => {
    const client = sdk();
    client.hostedCheckout.getHostedCheckout.mockResolvedValue({
      isSuccess: true,
      body: {
        status: 'PAYMENT_CREATED',
        createdPaymentOutput: {
          payment: { status: 'PENDING_CAPTURE', statusOutput: { statusCode: 5, isAuthorized: true } },
        },
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readHostedCheckout('hc-pending', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'pending',
    });
  });

  it('authorizes a hold from a hosted tokenization id without leaving the page', async () => {
    const client = sdk();
    client.payments.createPayment.mockResolvedValue({
      isSuccess: true,
      body: {
        payment: { id: 'pay-ht', status: 'PENDING_CAPTURE', statusOutput: { statusCode: 5, isAuthorized: true } },
        merchantAction: null,
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const result = await gateway.authorize('ht-1', 29.8, 'eur', {
      worldlineCredentials: CREDS,
      idempotencyKey: 'auth-ht',
      redirect: REDIRECT,
    });

    expect(result).toEqual({
      success: true,
      transactionId: 'pay-ht',
      providerStatus: 'succeeded',
    });
    expect(client.hostedCheckout.createHostedCheckout).not.toHaveBeenCalled();
    expect(client.payments.createPayment).toHaveBeenCalledWith(
      'psp-1',
      {
        hostedTokenizationId: 'ht-1',
        order: { amountOfMoney: { currencyCode: 'EUR', amount: 2980 } },
        cardPaymentMethodSpecificInput: {
          authorizationMode: 'PRE_AUTHORIZATION',
          returnUrl: 'https://hotel.example/return',
        },
      },
      { idempotence: { key: 'auth-ht' } },
    );
    const body = client.payments.createPayment.mock.calls[0][1];
    expect(body.cardPaymentMethodSpecificInput.card).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/cardNumber|cvv/i);
  });

  it('returns a bank challenge redirect and keeps the payment id', async () => {
    const client = sdk();
    client.payments.createPayment.mockResolvedValue({
      isSuccess: true,
      body: {
        payment: { id: 'pay-3ds', status: 'REDIRECTED' },
        merchantAction: {
          actionType: 'REDIRECT',
          redirectData: { redirectURL: 'https://bank.example/3ds' },
        },
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const result = await gateway.authorize('ht-3ds', 10, 'EUR', {
      worldlineCredentials: CREDS,
      redirect: REDIRECT,
    });
    expect(result).toEqual({
      success: true,
      transactionId: 'pay-3ds',
      providerStatus: 'requires_action',
      nextAction: { type: 'redirect', method: 'GET', url: 'https://bank.example/3ds', formFields: {} },
    });
  });

  it('does not report success when a tokenized payment is still incomplete', async () => {
    const client = sdk();
    client.payments.createPayment.mockResolvedValue({
      isSuccess: true,
      body: { payment: { id: 'pay-wait', status: 'PENDING_PAYMENT' }, merchantAction: null },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const result = await gateway.authorize('ht-wait', 10, 'EUR', {
      worldlineCredentials: CREDS,
      redirect: REDIRECT,
    });
    expect(result.success).toBe(false);
    expect(result.providerStatus).not.toBe('succeeded');
    expect(result.nextAction).toBeUndefined();
  });

  it('does not report success when a tokenized payment is declined', async () => {
    const client = sdk();
    client.payments.createPayment.mockResolvedValue({
      isSuccess: true,
      body: {
        payment: { id: 'pay-no', status: 'REJECTED', statusOutput: { statusCode: 1, statusCategory: 'REJECTED' } },
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    const result = await gateway.authorize('ht-no', 10, 'EUR', {
      worldlineCredentials: CREDS,
      redirect: REDIRECT,
    });
    expect(result.success).toBe(false);
    expect(result.providerStatus).toBe('failed');
  });

  it('creates an in-page tokenization session and fails closed without credentials', async () => {
    const client = sdk();
    client.hostedTokenization.createHostedTokenization.mockResolvedValue({
      isSuccess: true,
      body: {
        hostedTokenizationUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/tokenization/form/session-1',
        sri: 'sha384-abc',
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.createTokenizationSession({ worldlineCredentials: CREDS })).resolves.toEqual({
      ok: true,
      session: {
        hostedTokenizationUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/tokenization/form/session-1',
        sri: 'sha384-abc',
        tokenizerScriptUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/js/client/tokenizer.min.js',
      },
    });
    expect(client.hostedTokenization.createHostedTokenization).toHaveBeenCalledWith(
      'psp-1',
      { askConsumerConsent: false },
      {},
    );

    const live = new WorldlineGateway(config(), { clientFactory: () => client });
    client.hostedTokenization.createHostedTokenization.mockResolvedValue({
      isSuccess: true,
      body: { hostedTokenizationUrl: 'https://payment.direct.worldline-solutions.com/hostedtokenization/tokenization/form/session-2' },
    });
    const liveSession = await live.createTokenizationSession({
      worldlineCredentials: { ...CREDS, environment: 'live' },
    });
    expect(liveSession.ok && liveSession.session.tokenizerScriptUrl).toBe(
      'https://payment.direct.worldline-solutions.com/hostedtokenization/js/client/tokenizer.min.js',
    );

    const closed = new WorldlineGateway(config(), { clientFactory: () => client });
    const missing = await closed.createTokenizationSession();
    expect(missing).toEqual({ ok: false, errorMessage: expect.stringMatching(/credentials/i) });
  });

  it('finishes a bank challenge as authorized from payment details', async () => {
    const client = sdk();
    client.payments.getPaymentDetails.mockResolvedValue({
      isSuccess: true,
      body: { id: 'pay-9', status: 'PENDING_CAPTURE', statusOutput: { statusCode: 5, isAuthorized: true } },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('pay-9', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'authorized',
      paymentId: 'pay-9',
    });
    expect(client.payments.getPaymentDetails).toHaveBeenCalledWith('psp-1', 'pay-9', {});
    expect(client.hostedCheckout.getHostedCheckout).not.toHaveBeenCalled();
  });

  it('finishes a bank challenge as a capture when status code is 9', async () => {
    const client = sdk();
    client.payments.getPaymentDetails.mockResolvedValue({
      isSuccess: true,
      body: { id: 'pay-cap', status: 'CAPTURED', statusOutput: { statusCode: 9 } },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('pay-cap', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'captured',
      paymentId: 'pay-cap',
    });
    expect(client.hostedCheckout.getHostedCheckout).not.toHaveBeenCalled();
  });

  it('reports an immediate status code 9 payment as already captured', async () => {
    const client = sdk();
    client.payments.createPayment.mockResolvedValue({
      isSuccess: true,
      body: { payment: { id: 'pay-cap', status: 'CAPTURED', statusOutput: { statusCode: 9 } } },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.authorize('ht-cap', 10, 'EUR', {
      worldlineCredentials: CREDS,
      redirect: REDIRECT,
    })).resolves.toEqual({
      success: true,
      transactionId: 'pay-cap',
      providerStatus: 'succeeded',
      alreadyCaptured: true,
    });
  });

  it('finishes a bank challenge as declined when status code 2 has no status text', async () => {
    const client = sdk();
    client.payments.getPaymentDetails.mockResolvedValue({
      isSuccess: true,
      body: { id: 'pay-2', statusOutput: { statusCode: 2 } },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('pay-2', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'failed',
      paymentId: 'pay-2',
    });
    expect(client.hostedCheckout.getHostedCheckout).not.toHaveBeenCalled();
  });

  it('finishes a bank challenge as declined from payment details', async () => {
    const client = sdk();
    client.payments.getPaymentDetails.mockResolvedValue({
      isSuccess: true,
      body: { id: 'pay-no', status: 'REJECTED', statusOutput: { statusCode: 1, statusCategory: 'REJECTED' } },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('pay-no', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'failed',
      paymentId: 'pay-no',
    });
    expect(client.hostedCheckout.getHostedCheckout).not.toHaveBeenCalled();
  });

  it('leaves a bank challenge pending when payment details are not final', async () => {
    const client = sdk();
    client.payments.getPaymentDetails
      .mockResolvedValueOnce({
        isSuccess: true,
        body: { id: 'pay-wait', status: 'REDIRECTED' },
      })
      .mockResolvedValueOnce({
        isSuccess: true,
        body: { status: 'PENDING_CAPTURE', statusOutput: { statusCode: 5, isAuthorized: true } },
      });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('pay-wait', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'pending',
      paymentId: 'pay-wait',
    });
    await expect(gateway.readAuthorization('pay-wait', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'pending',
    });
    expect(client.hostedCheckout.getHostedCheckout).not.toHaveBeenCalled();
  });

  it('falls back to hosted checkout when payment details are not a payment', async () => {
    const client = sdk();
    client.payments.getPaymentDetails.mockResolvedValue({ isSuccess: false, status: 404, body: {} });
    client.hostedCheckout.getHostedCheckout.mockResolvedValue({
      isSuccess: true,
      body: {
        status: 'PAYMENT_CREATED',
        createdPaymentOutput: {
          payment: { id: 'pay-hc', status: 'PENDING_CAPTURE', statusOutput: { statusCode: 5, isAuthorized: true } },
        },
      },
    });
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('hc-9', { worldlineCredentials: CREDS })).resolves.toEqual({
      outcome: 'authorized',
      paymentId: 'pay-hc',
    });
    expect(client.hostedCheckout.getHostedCheckout).toHaveBeenCalledWith('psp-1', 'hc-9', {});
  });

  it('leaves a thrown payment-details read pending', async () => {
    const client = sdk();
    client.payments.getPaymentDetails.mockRejectedValue(new Error('network'));
    const gateway = new WorldlineGateway(config(), { clientFactory: () => client });
    await expect(gateway.readAuthorization('pay-down', { worldlineCredentials: CREDS })).resolves.toMatchObject({
      outcome: 'pending',
    });
    expect(client.hostedCheckout.getHostedCheckout).not.toHaveBeenCalled();
  });
});
