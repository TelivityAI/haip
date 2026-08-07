import { env, request, statusIn } from '../lib.mjs';

/** @returns {Promise<import('../lib.mjs').ProbeResult[]>} */
export async function runAuthOnProbes() {
  /** @type {import('../lib.mjs').ProbeResult[]} */
  const results = [];
  const propertyA = env('PROPERTY_A');

  if (!propertyA) {
    results.push({
      id: 'auth-unauthenticated',
      ok: false,
      skip: true,
      detail: 'PROPERTY_A not set — skip unauth probe',
    });
    return results;
  }

  try {
    const res = await request(
      `/v1/reservations?propertyId=${encodeURIComponent(propertyA)}`,
    );
    const ok = statusIn(res.status, [401]);
    results.push({
      id: 'auth-unauthenticated',
      ok,
      detail: ok
        ? `no token → ${res.status}`
        : `expected 401 without token, got ${res.status}`,
    });
  } catch (err) {
    results.push({
      id: 'auth-unauthenticated',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const tokenBad = env('TOKEN_BAD');
  if (tokenBad) {
    try {
      const res = await request(
        `/v1/reservations?propertyId=${encodeURIComponent(propertyA)}`,
        { token: tokenBad },
      );
      const ok = statusIn(res.status, [401]);
      results.push({
        id: 'auth-bad-token',
        ok,
        detail: ok
          ? `TOKEN_BAD → ${res.status}`
          : `expected 401 for TOKEN_BAD, got ${res.status}`,
      });
    } catch (err) {
      results.push({
        id: 'auth-bad-token',
        ok: false,
        detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    results.push({
      id: 'auth-bad-token',
      ok: true,
      skip: true,
      detail: 'TOKEN_BAD not set',
    });
  }

  return results;
}
