/**
 * Configuration for an Expedia (Expedia Group / EQC) channel connection.
 * Stored in channelConnections.config JSON.
 */
export interface ExpediaConfig {
  /** Expedia property (hotel) ID */
  hotelId: string;
  /** EQC username (sent in the in-message <Authentication> element) */
  username: string;
  /** EQC password */
  password: string;
  /**
   * Base URL. Live: https://services.expediapartnercentral.com
   * (AR → /eqc/ar, Booking Confirmation → /eqc/bc, Image API → /properties/{id}/images)
   */
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export const DEFAULT_EXPEDIA_CONFIG: Partial<ExpediaConfig> = {
  baseUrl: 'https://services.expediapartnercentral.com',
  timeoutMs: 30_000,
  maxRetries: 3,
};

/** EQC namespaces (versioned schemas). */
export const EXPEDIA_AR_NS = 'http://www.expediaconnect.com/EQC/AR/2011/06';
export const EXPEDIA_BC_NS = 'http://www.expediaconnect.com/EQC/BC/2007/09';
export const EXPEDIA_BR_NS = 'http://www.expediaconnect.com/EQC/BR/2014/01';
