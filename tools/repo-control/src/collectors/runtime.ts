import type { CollectorResult, RuntimeProbeConfig, SnapshotV1 } from '../lib/types.js';

export type { RuntimeProbeConfig };

const TIMEOUT_MS = 8000;

type FetchLike = typeof fetch;

/**
 * Public HTTP health probes only. Does not read logs, deploys, error trackers,
 * or production databases — those stay unconfigured until credentials exist.
 */
export async function collectRuntime(
  probes: RuntimeProbeConfig[],
  fetchImpl: FetchLike = fetch,
): Promise<{ collector: CollectorResult; data: SnapshotV1['runtime'] }> {
  const started = Date.now();
  if (!probes.length) {
    return {
      collector: {
        id: 'runtime',
        status: 'skipped',
        durationMs: 0,
        summary: 'No runtime probes configured',
      },
      data: {
        status: 'not_connected',
        note: 'No logs, deployments, error tracking, or production DB credentials are connected to Repo Control. Repository analysis cannot speak for production runtime.',
        sources: [],
      },
    };
  }

  const results = await Promise.all(
    probes.map(async (probe) => {
      const t0 = Date.now();
      try {
        const res = await fetchImpl(probe.url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return {
          id: probe.id,
          url: probe.url,
          httpStatus: res.status,
          durationMs: Date.now() - t0,
          error: null as string | null,
        };
      } catch (err) {
        return {
          id: probe.id,
          url: probe.url,
          httpStatus: null as number | null,
          durationMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const ok = results.filter((r) => r.httpStatus !== null && r.httpStatus >= 200 && r.httpStatus < 300);
  const checkedAt = new Date().toISOString();
  const sources = results.map((r) =>
    r.httpStatus === null
      ? `${r.id} unreachable (${r.error}) ${r.url}`
      : `${r.id} HTTP ${r.httpStatus} in ${r.durationMs}ms ${r.url}`,
  );

  return {
    collector: {
      id: 'runtime',
      status: 'ok',
      durationMs: Date.now() - started,
      summary: `${ok.length}/${results.length} health probes returned HTTP 2xx`,
    },
    data: {
      status: 'connected',
      note: `Public health probes at ${checkedAt}: ${ok.length}/${results.length} returned HTTP 2xx. This is availability only. Error tracking and production database credentials are not configured.`,
      sources,
    },
  };
}
