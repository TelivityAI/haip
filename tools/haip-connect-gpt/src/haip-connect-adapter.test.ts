import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HaipConnectAdapter, UpstreamError } from './haip-connect-adapter.js';

const BASE = 'http://haip.test';
const KEY = 'test-key';

function adapter() {
  return new HaipConnectAdapter({ baseUrl: `${BASE}/`, apiKey: KEY });
}

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('HaipConnectAdapter routing', () => {
  it('searchHotels POSTs to /api/v1/connect/search with x-api-key and JSON body', async () => {
    const f = mockFetch(200, { results: [] });
    globalThis.fetch = f as unknown as typeof fetch;

    await adapter().searchHotels({ city: 'NYC', checkIn: '2026-06-01', checkOut: '2026-06-03' });

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/connect/search`); // trailing slash on baseUrl trimmed
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(init.body as string)).toMatchObject({ city: 'NYC' });
  });

  it('getReservation GETs the verify path with encoded confirmation number', async () => {
    const f = mockFetch(200, { status: 'confirmed' });
    globalThis.fetch = f as unknown as typeof fetch;

    await adapter().getReservation('AB/12');

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/connect/bookings/AB%2F12/verify`);
    expect(init.method).toBe('GET');
  });

  it('cancelReservation DELETEs and forwards the reason', async () => {
    const f = mockFetch(200, { cancelled: true });
    globalThis.fetch = f as unknown as typeof fetch;

    await adapter().cancelReservation('XYZ', 'guest request');

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/connect/bookings/XYZ`);
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'guest request' });
  });
});

describe('HaipConnectAdapter behavior', () => {
  it('strips net-rate fields from successful responses', async () => {
    globalThis.fetch = mockFetch(200, {
      results: [{ rates: [{ totalAmount: 200, netRate: 150 }] }],
    }) as unknown as typeof fetch;

    const out = (await adapter().searchHotels({
      checkIn: '2026-06-01',
      checkOut: '2026-06-03',
    })) as { results: { rates: Record<string, unknown>[] }[] };

    expect(out.results[0].rates[0]['totalAmount']).toBe(200);
    expect(out.results[0].rates[0]).not.toHaveProperty('netRate');
  });

  it('throws UpstreamError carrying status + body on non-2xx', async () => {
    globalThis.fetch = mockFetch(404, { message: 'not found' }) as unknown as typeof fetch;

    await expect(adapter().getReservation('NOPE')).rejects.toMatchObject({
      status: 404,
      body: { message: 'not found' },
    });
    await expect(adapter().getReservation('NOPE')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('maps transport failures to a 502 UpstreamError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(
      adapter().searchHotels({ checkIn: '2026-06-01', checkOut: '2026-06-03' }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
