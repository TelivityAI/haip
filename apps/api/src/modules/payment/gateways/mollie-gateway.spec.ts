import { ConfigService } from '@nestjs/config';
import { MollieGateway } from './mollie-gateway';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    MOLLIE_API_KEY: 'test_mollie',
    MOLLIE_API_BASE: 'https://api.mollie.test/v2',
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

describe('MollieGateway', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('runs in console mode without API key', async () => {
    const gw = new MollieGateway(mockConfig({ MOLLIE_API_KEY: '' }), { fetchFn: fetchMock });
    const result = await gw.authorize('tok', 1, 'EUR');
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates manual-capture payment on authorize', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'tr_abc', status: 'authorized' }));
    const gw = new MollieGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.authorize('card_tok', 12.34, 'eur');

    expect(result.transactionId).toBe('tr_abc');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mollie.test/v2/payments');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.captureMode).toBe('manual');
    expect(body.cardToken).toBe('card_tok');
  });

  it('captures, voids, and refunds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'cap_1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'tr_abc' }))
      .mockResolvedValueOnce(jsonResponse({ id: 're_1' }));

    const gw = new MollieGateway(mockConfig(), { fetchFn: fetchMock });
    await gw.capture('tr_abc', 5);
    await gw.void('tr_abc');
    const refund = await gw.refund('tr_abc', 5);

    expect(refund.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/captures');
    expect(fetchMock.mock.calls[1][0]).toContain('/cancel');
    expect(fetchMock.mock.calls[2][0]).toContain('/refunds');
  });
});
