import { ConfigService } from '@nestjs/config';
import { RedsysGateway } from './redsys-gateway';
import {
  REDSYS_SANDBOX,
  REDSYS_SIGNATURE_VERSION,
  decodeMerchantParameters,
  diversifyKey,
  encodeMerchantParameters,
  signMerchantParameters,
  verifyMerchantParametersSignature,
} from './redsys-crypto';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    REDSYS_MERCHANT_CODE: REDSYS_SANDBOX.merchantCode,
    REDSYS_TERMINAL: REDSYS_SANDBOX.terminal,
    REDSYS_SECRET_KEY: REDSYS_SANDBOX.secretKey,
    REDSYS_ENV: 'test',
    ...overrides,
  };
  return {
    get: (key: string, defaultValue?: string) =>
      values[key] !== undefined ? values[key] : defaultValue,
  } as ConfigService;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lifecycleResponse(type = '2', changes: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) {
  const params = encodeMerchantParameters({
    Ds_Order: '1234ABCDEF', Ds_MerchantCode: REDSYS_SANDBOX.merchantCode, Ds_Terminal: '1',
    Ds_Amount: '1234', Ds_Currency: '978', Ds_TransactionType: type,
    Ds_Response: type === '9' ? '0400' : '0900', ...changes,
  } as Record<string, string>);
  return jsonResponse({
    Ds_MerchantParameters: params, Ds_SignatureVersion: REDSYS_SIGNATURE_VERSION,
    Ds_Signature: signMerchantParameters(params, REDSYS_SANDBOX.secretKey, '1234ABCDEF'), ...envelope,
  });
}

describe('redsys-crypto', () => {
  it('matches Redsys HMAC_SHA512_V2 golden vector', () => {
    const secret = 'sq7HjrUOBfKmC576ILgskD5srU870gJ7';
    const order = '1234567890';
    const merchantParams =
      'eyJEU19NRVJDSEFOVF9BTU9VTlQiOiI5OTkiLCJEU19NRVJDSEFOVF9PUkRFUiI6IjEyMzQ1Njc4OTAiLCJEU19NRVJDSEFOVF9NRVJDSEFOVENPREUiOiI5OTkwMDg4ODEiLCJEU19NRVJDSEFOVF9DVVJSRU5DWSI6Ijk3OCIsIkRTX01FUkNIQU5UX1RSQU5TQUNUSU9OVFlQRSI6IjAiLCJEU19NRVJDSEFOVF9URVJNSU5BTCI6IjEiLCJEU19NRVJDSEFOVF9NRVJDSEFOVFVSTCI6Imh0dHA6XC9cL3d3dy5wcnVlYmEuY29tXC91cmxOb3RpZmljYWNpb24ucGhwIiwiRFNfTUVSQ0hBTlRfVVJMT0siOiJodHRwOlwvXC93d3cucHJ1ZWJhLmNvbVwvdXJsT0sucGhwIiwiRFNfTUVSQ0hBTlRfVVJMS08iOiJodHRwOlwvXC93d3cucHJ1ZWJhLmNvbVwvdXJsS08ucGhwIn0';

    expect(diversifyKey(secret, order)).toBe('RWt3/IPTzYRMXsQtkiGRKg==');
    expect(signMerchantParameters(merchantParams, secret, order)).toBe(
      'Vjo02eSWq249IeZZp3R-ArFnGLhKY0OuzDDlx1BuVtZDC2yhczA7_11uZhsYzLZBCMFAz8u8uzGDX3AErHKmmw',
    );
    expect(
      verifyMerchantParametersSignature(
        merchantParams,
        'Vjo02eSWq249IeZZp3R-ArFnGLhKY0OuzDDlx1BuVtZDC2yhczA7_11uZhsYzLZBCMFAz8u8uzGDX3AErHKmmw',
        secret,
        order,
      ),
    ).toBe(true);
  });

  it('round-trips merchant parameters', () => {
    const encoded = encodeMerchantParameters({ DS_MERCHANT_ORDER: 'ABCD1234' });
    expect(decodeMerchantParameters(encoded).DS_MERCHANT_ORDER).toBe('ABCD1234');
  });
});

describe('RedsysGateway', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it.each(['production', 'staging', 'development'])('fails closed without credentials in %s', async (environment) => {
    const gw = new RedsysGateway(
      mockConfig({ NODE_ENV: environment, PAYMENT_GATEWAY: 'redsys', REDSYS_MERCHANT_CODE: '', REDSYS_SECRET_KEY: '' }),
      { fetchFn: fetchMock },
    );
    for (const result of await Promise.all([
      gw.authorize('tok', 10, 'EUR'), gw.capture('1234ABC', 10),
      gw.void('1234ABC'), gw.refund('1234ABC', 10),
    ])) {
      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/credentials/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds a signed redirect nextAction on authorize', async () => {
    const gw = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.authorize('redsys_redirect', 12.34, 'EUR', {
      redirect: {
        merchantUrl: 'https://api.example.com/api/v1/webhooks/redsys',
        urlOk: 'https://booking.example.com/ok',
        urlKo: 'https://booking.example.com/ko',
      },
    });

    expect(result.success).toBe(true);
    expect(result.providerStatus).toBe('requires_action');
    expect(result.nextAction?.type).toBe('redirect');
    expect(result.nextAction?.method).toBe('POST');
    expect(result.nextAction?.url).toContain('realizarPago');
    expect(result.nextAction?.formFields.Ds_MerchantParameters).toBeTruthy();
    expect(result.nextAction?.formFields.Ds_Signature).toBeTruthy();
    expect(result.transactionId.length).toBeGreaterThanOrEqual(4);
    expect(fetchMock).not.toHaveBeenCalled();

    const params = decodeMerchantParameters(
      result.nextAction!.formFields.Ds_MerchantParameters,
    );
    expect(params.DS_MERCHANT_TRANSACTIONTYPE).toBe('1');
    expect(params.DS_MERCHANT_AMOUNT).toBe('1234');
    expect(params.DS_MERCHANT_CURRENCY).toBe('978');
  });

  it('rejects authorize without redirect URLs', async () => {
    const gw = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.authorize('redsys_redirect', 10, 'EUR');
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/redirect/i);
  });

  it.each([['EUR', 12.34, '1234'], ['JPY', 100, '100']] as const)(
    'sends exact %s minor units for authorization, capture and refund', async (currency, amount, expected) => {
      const gw = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
      const result = await gw.authorize('redsys_redirect', amount, currency, {
        redirect: { merchantUrl: 'https://api.example/notify', urlOk: 'https://hotel.example/ok', urlKo: 'https://hotel.example/ko' },
      });
      expect(decodeMerchantParameters(result.nextAction!.formFields.Ds_MerchantParameters).DS_MERCHANT_AMOUNT).toBe(expected);
      fetchMock.mockResolvedValue(jsonResponse({ errorCode: 'TEST_DECLINE' }));
      await gw.capture('1234ABCDEF', amount, { currencyCode: currency });
      await gw.refund('1234ABCDEF', amount, { currencyCode: currency });
      for (const [, request] of fetchMock.mock.calls) {
        expect(decodeMerchantParameters(JSON.parse(request.body).Ds_MerchantParameters).DS_MERCHANT_AMOUNT).toBe(expected);
      }
    },
  );

  it('captures via REST using per-call merchant credentials', async () => {
    const orderId = '1234ABCDEF';
    const responseParams = encodeMerchantParameters({
      Ds_Order: orderId,
      Ds_Response: '0900',
      Ds_Amount: '1234', Ds_Currency: '978', Ds_TransactionType: '2',
      Ds_MerchantCode: REDSYS_SANDBOX.merchantCode, Ds_Terminal: '1',
    });
    const signature = signMerchantParameters(
      responseParams,
      REDSYS_SANDBOX.secretKey,
      orderId,
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Ds_MerchantParameters: responseParams,
        Ds_Signature: signature,
        Ds_SignatureVersion: 'HMAC_SHA512_V2',
      }),
    );

    const gw = new RedsysGateway(mockConfig({ REDSYS_MERCHANT_CODE: '' }), {
      fetchFn: fetchMock,
    });
    const result = await gw.capture(orderId, 12.34, {
      currencyCode: 'EUR',
      merchantCredentials: {
        merchantCode: REDSYS_SANDBOX.merchantCode,
        terminal: REDSYS_SANDBOX.terminal,
        secretKey: REDSYS_SANDBOX.secretKey,
        environment: 'test',
      },
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const sent = decodeMerchantParameters(body.Ds_MerchantParameters);
    expect(sent.DS_MERCHANT_TRANSACTIONTYPE).toBe('2');
    expect(sent.DS_MERCHANT_AMOUNT).toBe('1234');
  });

  it.each([
    ['missing signature', {}, { Ds_Signature: undefined }],
    ['missing signature version', {}, { Ds_SignatureVersion: undefined }],
    ['wrong signature version', {}, { Ds_SignatureVersion: 'HMAC_SHA256_V1' }],
    ['wrong signature', {}, { Ds_Signature: 'invalid' }],
    ['wrong order', { Ds_Order: '9876OTHER' }, {}],
    ['wrong merchant', { Ds_MerchantCode: '111111111' }, {}],
    ['wrong terminal', { Ds_Terminal: '2' }, {}],
    ['malformed terminal', { Ds_Terminal: '1x' }, {}],
    ['wrong amount', { Ds_Amount: '1235' }, {}],
    ['missing amount', { Ds_Amount: undefined }, {}],
    ['wrong currency', { Ds_Currency: '392' }, {}],
    ['wrong operation', { Ds_TransactionType: '9', Ds_Response: '0400' }, {}],
    ['wrong success code', { Ds_Response: '0000' }, {}],
    ['void success code', { Ds_Response: '0400' }, {}],
    ['malformed success code', { Ds_Response: '0900junk' }, {}],
    ['numeric success code', { Ds_Response: 900 }, {}],
    ['missing success code', { Ds_Response: undefined }, {}],
    ['malformed parameters', {}, { Ds_MerchantParameters: 'not-json' }],
    ['non-string parameters', {}, { Ds_MerchantParameters: { unexpected: true } }],
  ])('rejects a lifecycle response with %s', async (_name, changes, envelope) => {
    fetchMock.mockResolvedValue(lifecycleResponse('2', changes as any, envelope as any));
    const gateway = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
    await expect(gateway.capture('1234ABCDEF', 12.34, { currencyCode: 'EUR' })).resolves.toMatchObject({ success: false });
  });

  it.each([['capture', '2'], ['refund', '3'], ['void', '9']] as const)(
    'accepts an authenticated matching %s response', async (operation, type) => {
      fetchMock.mockResolvedValue(lifecycleResponse(type));
      const gateway = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
      const options = { currencyCode: 'EUR', authorizedAmount: 12.34 };
      const result = operation === 'void' ? await gateway.void('1234ABCDEF', options)
        : await gateway[operation]('1234ABCDEF', 12.34, options);
      expect(result.success).toBe(true);
    },
  );

  it.each(['capture', 'refund', 'void'] as const)('rejects %s without its amount before contacting the provider', async (operation) => {
    fetchMock.mockResolvedValue(jsonResponse({ errorCode: 'TEST_DECLINE' }));
    const gateway = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
    await expect(gateway[operation]('1234ABCDEF')).resolves.toMatchObject({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe failure for correctly signed malformed response JSON', async () => {
    const parameters = Buffer.from('null').toString('base64url');
    fetchMock.mockResolvedValue(jsonResponse({ Ds_MerchantParameters: parameters, Ds_SignatureVersion: REDSYS_SIGNATURE_VERSION,
      Ds_Signature: signMerchantParameters(parameters, REDSYS_SANDBOX.secretKey, '1234ABCDEF') }));
    const gateway = new RedsysGateway(mockConfig(), { fetchFn: fetchMock });
    await expect(gateway.capture('1234ABCDEF', 12.34)).resolves.toMatchObject({ success: false });
  });
});
