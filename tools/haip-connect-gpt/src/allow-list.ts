/**
 * Per-property AI distribution allow-list.
 *
 * Search may use a ≤60s cache. Detail and prepareBooking MUST call
 * isPropertyEnabledLive() so a hotel toggled OFF is immediately 404.
 */

export interface AllowListSource {
  /** Fetch the full set of enabled property IDs. */
  listEnabled(): Promise<string[]>;
  /** Live check for one property (no cache). */
  isEnabled(propertyId: string): Promise<boolean>;
}

export class AllowList {
  private cachedIds: Set<string> | null = null;
  private cachedAt = 0;
  private readonly ttlMs: number;

  constructor(
    private readonly source: AllowListSource,
    ttlMs = 60_000,
  ) {
    this.ttlMs = ttlMs;
  }

  async getCachedEnabledIds(): Promise<Set<string>> {
    const now = Date.now();
    if (this.cachedIds && now - this.cachedAt < this.ttlMs) {
      return this.cachedIds;
    }
    const ids = await this.source.listEnabled();
    this.cachedIds = new Set(ids);
    this.cachedAt = now;
    return this.cachedIds;
  }

  /** Search filter — may be up to ttlMs stale. */
  async filterPropertyIds(ids: string[]): Promise<string[]> {
    const enabled = await this.getCachedEnabledIds();
    return ids.filter((id) => enabled.has(id));
  }

  async isEnabledCached(propertyId: string): Promise<boolean> {
    const enabled = await this.getCachedEnabledIds();
    return enabled.has(propertyId);
  }

  /** Detail / book — always live. */
  async isPropertyEnabledLive(propertyId: string): Promise<boolean> {
    return this.source.isEnabled(propertyId);
  }

  /** Test helper */
  clearCache(): void {
    this.cachedIds = null;
    this.cachedAt = 0;
  }
}

/** Remote allow-list API (service token). */
export function distributionAllowListSource(opts: {
  baseUrl: string;
  serviceToken: string;
  fetchImpl?: typeof fetch;
}): AllowListSource {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const fetchFn = opts.fetchImpl ?? fetch;
  const headers = {
    'x-service-token': opts.serviceToken,
    accept: 'application/json',
  };

  return {
    async listEnabled() {
      const res = await fetchFn(`${base}/api/ai-distribution/allow-list`, { headers });
      if (!res.ok) {
        throw new Error(`allow-list fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as { propertyIds?: string[] };
      return body.propertyIds ?? [];
    },
    async isEnabled(propertyId: string) {
      const res = await fetchFn(
        `${base}/api/ai-distribution/allow-list/${encodeURIComponent(propertyId)}`,
        { headers },
      );
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`allow-list property check failed: ${res.status}`);
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    },
  };
}

/** Env / static allow-list for local demos (comma-separated UUIDs). */
export function staticAllowListSource(propertyIds: string[]): AllowListSource {
  const set = new Set(propertyIds.filter(Boolean));
  return {
    async listEnabled() {
      return [...set];
    },
    async isEnabled(propertyId: string) {
      return set.has(propertyId);
    },
  };
}

export function createAllowListFromEnv(env: NodeJS.ProcessEnv = process.env): AllowList | null {
  const distributionUrl = env['AI_DISTRIBUTION_BASE_URL'];
  const token = env['AI_DISTRIBUTION_SERVICE_TOKEN'];
  if (distributionUrl && token) {
    return new AllowList(
      distributionAllowListSource({ baseUrl: distributionUrl, serviceToken: token }),
    );
  }
  const staticIds = (env['ALLOWED_PROPERTY_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (staticIds.length > 0) {
    return new AllowList(staticAllowListSource(staticIds));
  }
  // Fail-closed when no source configured: empty allow-list.
  // Set ALLOW_ALL_PROPERTIES=true only for local Connect demos without an allow-list API.
  if (env['ALLOW_ALL_PROPERTIES'] === 'true') {
    return new AllowList({
      async listEnabled() {
        return [];
      },
      async isEnabled() {
        return true;
      },
    });
  }
  return new AllowList(staticAllowListSource([]));
}
