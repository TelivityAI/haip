import { ConfigService } from '@nestjs/config';
import { RedsysGateway } from './redsys-gateway';
import {
  REDSYS_SANDBOX,
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

  it('runs in console mode without credentials', async () => {
    const gw = new RedsysGateway(
      mockConfig({ REDSYS_MERCHANT_CODE: '', REDSYS_SECRET_KEY: '' }),
      { fetchFn: fetchMock },
    );
    const result = await gw.authorize('tok', 10, 'EUR');
    expect(result.success).toBe(true);
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

  it('captures via REST using per-call merchant credentials', async () => {
    const orderId = '1234ABCDEF';
    const responseParams = encodeMerchantParameters({
      Ds_Order: orderId,
      Ds_Response: '0900',
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
});
