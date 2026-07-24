import { ConfigService } from '@nestjs/config';
import { BraintreeGateway } from './braintree-gateway';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    BRAINTREE_MERCHANT_ID: 'merchant1',
    BRAINTREE_PUBLIC_KEY: 'pub',
    BRAINTREE_PRIVATE_KEY: 'priv',
    BRAINTREE_API_BASE: 'https://braintree.test',
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

describe('BraintreeGateway', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('console mode without merchant credentials', async () => {
    const gw = new BraintreeGateway(mockConfig({ BRAINTREE_MERCHANT_ID: '' }), {
      fetchFn: fetchMock,
    });
    await gw.authorize('nonce', 1, 'USD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates authorization without settlement', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ transaction: { id: 'tx_1', status: 'authorized' } }),
    );
    const gw = new BraintreeGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.authorize('fake-valid-nonce', 44.1, 'USD');

    expect(result.transactionId).toBe('tx_1');
    const init = fetchMock.mock.calls[0][1];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toMatch(/^Basic /);
    const body = JSON.parse(init.body);
    expect(body.transaction.options.submitForSettlement).toBe(false);
  });

  it('submits for settlement, voids, and refunds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: 'tx_1' } }))
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: 'tx_1' } }))
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: 'tx_ref' } }));

    const gw = new BraintreeGateway(mockConfig(), { fetchFn: fetchMock });
    await gw.capture('tx_1', 10);
    await gw.void('tx_1');
    const refund = await gw.refund('tx_1', 5);

    expect(refund.transactionId).toBe('tx_ref');
    expect(fetchMock.mock.calls[0][0]).toContain('submit_for_settlement');
    expect(fetchMock.mock.calls[1][0]).toContain('/void');
    expect(fetchMock.mock.calls[2][0]).toContain('/refund');
  });
});
