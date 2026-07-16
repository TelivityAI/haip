/**
 * Configuration for a DerbySoft Property Connector channel connection.
 * Stored in channelConnections.config JSON.
 *
 * Vendor protocol: REST/JSON, OAuth2 client-credentials Bearer token,
 * 15 req/s rate limit. See docs/channels/derbysoft.md.
 */
export interface DerbySoftConfig {
  /** PMS hotel id registered with DerbySoft (maps to hotelId in PC API). */
  hotelId: string;

  /** Account / client id used as Basic auth username for token endpoint. */
  accountId: string;

  /** Client secret for token endpoint (Basic password). */
  clientSecret: string;

  /**
   * Tunnel base URL (ARI + resStatus).
   * Mock: http://localhost:4002/pcapigateway/tunnel/{accountId}
   * Test: https://pcendpoint.derbysoft-test.com/pcapigateway/tunnel/{accountId}
   */
  tunnelBaseUrl: string;

  /**
   * Profile base URL (property / content / channel).
   * Mock: http://localhost:4002/pcapigateway/profile/{accountId}
   */
  profileBaseUrl: string;

  /**
   * Token endpoint.
   * Mock: http://localhost:4002/pcapigateway/account/token
   */
  tokenUrl: string;

  /**
   * ARI update mode — Delta (incremental) or Overlay (full refresh).
   * Default Delta; Overlay used for full flush / launch.
   */
  ariUpdateType?: 'Delta' | 'Overlay';

  /** Request timeout in milliseconds (default: 30000). */
  timeoutMs?: number;

  /** Max retry attempts for failed requests (default: 3). */
  maxRetries?: number;
}

export const DEFAULT_DERBYSOFT_CONFIG: Partial<DerbySoftConfig> = {
  tunnelBaseUrl: 'http://localhost:4002/pcapigateway/tunnel/{accountId}',
  profileBaseUrl: 'http://localhost:4002/pcapigateway/profile/{accountId}',
  tokenUrl: 'http://localhost:4002/pcapigateway/account/token',
  ariUpdateType: 'Delta',
  timeoutMs: 30_000,
  maxRetries: 3,
};

/** DerbySoft Property Connector max sustained request rate. */
export const DERBYSOFT_RATE_LIMIT_PER_SEC = 15;

export const DERBYSOFT_MESSAGE_VERSION = '0.1';
