import { gatewayJsonRequest, toMinorUnits, toMajorAmountString } from './payment-gateway-http';

describe('payment-gateway-http', () => {
  it('converts currency minor units', () => {
    expect(toMinorUnits(10.5)).toBe(1050);
    expect(toMajorAmountString(10.5)).toBe('10.50');
  });

  it('parses JSON success responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'ok' }), { status: 200 }),
    );
    const res = await gatewayJsonRequest('https://example.test', { method: 'GET' }, fetchFn);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ id: 'ok' });
  });

  it('surfaces HTTP errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), { status: 422 }),
    );
    const res = await gatewayJsonRequest('https://example.test', { method: 'POST' }, fetchFn);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toBe('nope');
  });
});
