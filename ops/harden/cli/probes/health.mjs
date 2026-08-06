import { request, statusIn } from '../lib.mjs';

/** @returns {Promise<import('../lib.mjs').ProbeResult[]>} */
export async function runHealthProbes() {
  /** @type {import('../lib.mjs').ProbeResult[]} */
  const results = [];
  try {
    const res = await request('/v1/health');
    const ok =
      statusIn(res.status, [200]) &&
      (res.json?.status === 'ok' || res.bodyText.includes('"ok"'));
    results.push({
      id: 'health',
      ok,
      detail: ok
        ? `${res.status} ${res.url}`
        : `expected 200 status=ok, got ${res.status} ${res.bodyText.slice(0, 120)}`,
    });
  } catch (err) {
    results.push({
      id: 'health',
      ok: false,
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return results;
}
