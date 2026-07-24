import { ConfigService } from '@nestjs/config';
import { AdyenGateway } from './adyen-gateway';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    ADYEN_API_KEY: 'test_adyen_key',
    ADYEN_MERCHANT_ACCOUNT: 'TestMerchant',
    ADYEN_ENV: 'test',
    ADYEN_CHECKOUT_URL: 'https://checkout-test.example/v71',
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

describe('AdyenGateway', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('uses console mode when credentials are missing', async () => {
    const gw = new AdyenGateway(
      mockConfig({ ADYEN_API_KEY: '', ADYEN_MERCHANT_ACCOUNT: '' }),
      { fetchFn: fetchMock },
    );
    const result = await gw.authorize('tok', 10, 'EUR');
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authorizes with manual capture delay', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ pspReference: 'PSP123', resultCode: 'Authorised' }),
    );
    const gw = new AdyenGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.authorize('pm_adyen', 99.5, 'USD', { idempotencyKey: 'k1' });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('PSP123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://checkout-test.example/v71/payments',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.get('Idempotency-Key')).toBe('k1');
    const body = JSON.parse(init.body);
    expect(body.amount).toEqual({ currency: 'USD', value: 9950 });
    expect(body.paymentMethod).toEqual({ storedPaymentMethodId: 'pm_adyen' });
  });

  it('captures via modifications endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pspReference: 'CAP1', status: 'received' }));
    const gw = new AdyenGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.capture('PSP123', 50);
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/payments/PSP123/captures');
  });

  it('voids via cancel endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pspReference: 'VOID1' }));
    const gw = new AdyenGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.void('PSP123');
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/cancels');
  });

  it('refunds via refund endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pspReference: 'REF1' }));
    const gw = new AdyenGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.refund('PSP123', 25);
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('REF1');
  });
});
