import { ConfigService } from '@nestjs/config';
import { SquareGateway } from './square-gateway';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    SQUARE_ACCESS_TOKEN: 'sq_token',
    SQUARE_LOCATION_ID: 'LOC1',
    SQUARE_API_BASE: 'https://square.test/v2',
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

describe('SquareGateway', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('console mode when token or location missing', async () => {
    const gw = new SquareGateway(mockConfig({ SQUARE_LOCATION_ID: '' }), { fetchFn: fetchMock });
    await gw.authorize('n', 1, 'USD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authorizes with autocomplete false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ payment: { id: 'pay_1', status: 'APPROVED' } }),
    );
    const gw = new SquareGateway(mockConfig(), { fetchFn: fetchMock });
    const result = await gw.authorize('cnon:abc', 20, 'USD');

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('pay_1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.autocomplete).toBe(false);
    expect(body.source_id).toBe('cnon:abc');
  });

  it('completes, cancels, and refunds payments', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ payment: { id: 'pay_1' } }))
      .mockResolvedValueOnce(jsonResponse({ payment: { id: 'pay_1' } }))
      .mockResolvedValueOnce(jsonResponse({ refund: { id: 'ref_1' } }));

    const gw = new SquareGateway(mockConfig(), { fetchFn: fetchMock });
    await gw.capture('pay_1');
    await gw.void('pay_1');
    const refund = await gw.refund('pay_1', 10);

    expect(refund.transactionId).toBe('ref_1');
    expect(fetchMock.mock.calls[0][0]).toContain('/complete');
    expect(fetchMock.mock.calls[1][0]).toContain('/cancel');
    expect(fetchMock.mock.calls[2][0]).toBe('https://square.test/v2/refunds');
  });
});
