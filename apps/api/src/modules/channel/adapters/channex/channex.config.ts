export interface ChannexConfig {
  apiKey: string;
  propertyId: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Soft client-side ARI pacing (Channex documents ~20 ARI requests/minute). */
  ariRateLimitPerMinute?: number;
}

export const DEFAULT_CHANNEX_CONFIG: Omit<ChannexConfig, 'apiKey' | 'propertyId'> = {
  baseUrl: 'https://api.channex.io/api/v1',
  timeoutMs: 30_000,
  maxRetries: 3,
  ariRateLimitPerMinute: 20,
};

/** Staging API — use in connection config.baseUrl for certification. */
export const CHANNEX_STAGING_BASE_URL = 'https://staging.channex.io/api/v1';
