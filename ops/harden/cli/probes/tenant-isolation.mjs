import { env, requireEnv, request, statusIn } from '../lib.mjs';

/** @returns {Promise<import('../lib.mjs').ProbeResult[]>} */
export async function runTenantIsolationProbes() {
  /** @type {import('../lib.mjs').ProbeResult[]} */
  const results = [];

  let tokenA;
  let tokenB;
  let propertyA;
  let propertyB;
  try {
    tokenA = requireEnv('TOKEN_A');
    tokenB = requireEnv('TOKEN_B');
    propertyA = requireEnv('PROPERTY_A');
    propertyB = requireEnv('PROPERTY_B');
  } catch (err) {
    results.push({
      id: 'tenant-env',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return results;
  }

  if (propertyA === propertyB) {
    results.push({
      id: 'tenant-env',
      ok: false,
      detail: 'PROPERTY_A and PROPERTY_B must be different UUIDs',
    });
    return results;
  }

  results.push({
    id: 'tenant-env',
    ok: true,
    detail: 'TOKEN_A/B and PROPERTY_A/B present',
  });

  // A may read A
  try {
    const res = await request(
      `/v1/reservations?propertyId=${encodeURIComponent(propertyA)}`,
      { token: tokenA },
    );
    const ok = statusIn(res.status, [200]);
    results.push({
      id: 'tenant-a-reads-a',
      ok,
      detail: ok
        ? `TOKEN_A + PROPERTY_A → ${res.status}`
        : `expected 200, got ${res.status}`,
    });
  } catch (err) {
    results.push({
      id: 'tenant-a-reads-a',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // A must not read B
  try {
    const res = await request(
      `/v1/reservations?propertyId=${encodeURIComponent(propertyB)}`,
      { token: tokenA },
    );
    const ok = statusIn(res.status, [403, 401]);
    results.push({
      id: 'tenant-a-denied-b',
      ok,
      detail: ok
        ? `TOKEN_A + PROPERTY_B → ${res.status}`
        : `expected 403 or 401, got ${res.status}`,
    });
  } catch (err) {
    results.push({
      id: 'tenant-a-denied-b',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // B may read B (sanity)
  try {
    const res = await request(
      `/v1/reservations?propertyId=${encodeURIComponent(propertyB)}`,
      { token: tokenB },
    );
    const ok = statusIn(res.status, [200]);
    results.push({
      id: 'tenant-b-reads-b',
      ok,
      detail: ok
        ? `TOKEN_B + PROPERTY_B → ${res.status}`
        : `expected 200, got ${res.status}`,
    });
  } catch (err) {
    results.push({
      id: 'tenant-b-reads-b',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const reservationInB = env('RESERVATION_IN_B');
  if (reservationInB) {
    try {
      const res = await request(
        `/v1/reservations/${encodeURIComponent(reservationInB)}?propertyId=${encodeURIComponent(propertyB)}`,
        { token: tokenA },
      );
      const ok = statusIn(res.status, [403, 404, 401]);
      results.push({
        id: 'tenant-a-denied-res-b',
        ok,
        detail: ok
          ? `TOKEN_A + RESERVATION_IN_B → ${res.status}`
          : `expected 403/404/401, got ${res.status}`,
      });
    } catch (err) {
      results.push({
        id: 'tenant-a-denied-res-b',
        ok: false,
        detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    results.push({
      id: 'tenant-a-denied-res-b',
      ok: true,
      skip: true,
      detail: 'RESERVATION_IN_B not set',
    });
  }

  return results;
}
