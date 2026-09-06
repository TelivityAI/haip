import { env, request, statusIn } from '../lib.mjs';

const REQUIRED_OWNER_ENV = [
  'OWNER_TOKEN',
  'OWNER_PROPERTY_A',
  'OWNER_PROPERTY_B',
  'OWNER_RESERVATION_IN_B',
  'OWNER_GUEST_IN_B',
  'OWNER_ROOM_TYPE_IN_A',
  'OWNER_RATE_PLAN_IN_A',
];

/**
 * Same-user, multi-property confused-deputy probes. The owner token is expected
 * to contain both property ids, so authorization alone cannot catch an entity
 * id from B paired with propertyId A; repository/service scoping must return 404.
 *
 * @returns {Promise<import('../lib.mjs').ProbeResult[]>}
 */
export async function runOwnerIsolationProbes() {
  const missing = REQUIRED_OWNER_ENV.filter((name) => !env(name));
  if (missing.length > 0) {
    return [{
      id: 'owner-isolation',
      ok: true,
      skip: true,
      detail: `owner multi-property env not complete — missing ${missing.join(', ')}`,
    }];
  }

  const token = env('OWNER_TOKEN');
  const propertyA = env('OWNER_PROPERTY_A');
  const propertyB = env('OWNER_PROPERTY_B');
  const reservationInB = env('OWNER_RESERVATION_IN_B');
  const guestInB = env('OWNER_GUEST_IN_B');
  const roomTypeInA = env('OWNER_ROOM_TYPE_IN_A');
  const ratePlanInA = env('OWNER_RATE_PLAN_IN_A');
  /** @type {import('../lib.mjs').ProbeResult[]} */
  const results = [];

  if (propertyA === propertyB) {
    return [{
      id: 'owner-env',
      ok: false,
      detail: 'OWNER_PROPERTY_A and OWNER_PROPERTY_B must be different UUIDs',
    }];
  }

  try {
    const res = await request(
      `/v1/reservations/${encodeURIComponent(reservationInB)}?propertyId=${encodeURIComponent(propertyA)}`,
      { token },
    );
    const ok = statusIn(res.status, [404]);
    results.push({
      id: 'owner-b-id-scoped-as-a',
      ok,
      detail: ok
        ? `B reservation + propertyId=A → ${res.status}`
        : `expected 404, got ${res.status}`,
    });
  } catch (err) {
    results.push({
      id: 'owner-b-id-scoped-as-a',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const arrivalDate = env('OWNER_TEST_ARRIVAL', '2099-01-01');
  const departureDate = env('OWNER_TEST_DEPARTURE', '2099-01-02');
  try {
    const res = await request('/v1/reservations', {
      method: 'POST',
      token,
      body: {
        propertyId: propertyA,
        guestId: guestInB,
        arrivalDate,
        departureDate,
        roomTypeId: roomTypeInA,
        ratePlanId: ratePlanInA,
        totalAmount: env('OWNER_TEST_TOTAL', '100.00'),
        currencyCode: env('OWNER_TEST_CURRENCY', 'USD'),
        adults: 1,
        children: 0,
        source: 'direct',
        channelCode: 'harden_owner_probe',
      },
    });
    const ok = statusIn(res.status, [404]);
    results.push({
      id: 'owner-b-guest-scoped-as-a',
      ok,
      detail: ok
        ? `B-only guest + propertyId=A → ${res.status}`
        : `expected 404, got ${res.status}; investigate guest ownership before go-live`,
    });
  } catch (err) {
    results.push({
      id: 'owner-b-guest-scoped-as-a',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}
