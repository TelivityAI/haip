import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';

function stubAdapter() {
  return {
    searchHotels: async () => ({ results: [] }),
    getProperty: async () => ({ id: 'p1' }),
    createReservation: async () => ({ confirmationNumber: 'HAIP-X' }),
    getReservation: async () => ({ confirmationNumber: 'HAIP-X' }),
    modifyReservation: async () => ({ ok: true }),
    cancelReservation: async () => ({ ok: true }),
    upstreamHealthy: async () => true,
  } as any;
}

const GATEWAY_KEY = 'gw_secret_key';

describe('gateway authentication', () => {
  it('allows /health without a credential', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x', gatewayApiKey: GATEWAY_KEY });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows /openapi.json without a credential', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x', gatewayApiKey: GATEWAY_KEY });
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects an action route with no credential (401)', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x', gatewayApiKey: GATEWAY_KEY });
    const res = await app.inject({ method: 'POST', url: '/hotels/search', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an action route with a wrong credential (401)', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x', gatewayApiKey: GATEWAY_KEY });
    const res = await app.inject({
      method: 'POST',
      url: '/hotels/search',
      headers: { authorization: 'Bearer wrong' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('allows an action route with the correct Bearer credential', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x', gatewayApiKey: GATEWAY_KEY });
    const res = await app.inject({
      method: 'POST',
      url: '/hotels/search',
      headers: { authorization: `Bearer ${GATEWAY_KEY}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('fails closed: no key configured and not explicitly public → 401', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x' });
    const res = await app.inject({ method: 'POST', url: '/hotels/search', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('explicit opt-out (allowPublic) keeps the demo open', async () => {
    const app = buildApp({ adapter: stubAdapter(), publicBaseUrl: 'http://x', allowPublic: true });
    const res = await app.inject({ method: 'POST', url: '/hotels/search', payload: {} });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
