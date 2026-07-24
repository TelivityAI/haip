export interface ChannexConfig {
  apiKey: string;
  propertyId: string;
  baseUrl: string;
  timeoutMs?: number;
}

export const DEFAULT_CHANNEX_CONFIG: Omit<ChannexConfig, 'apiKey' | 'propertyId'> = {
  baseUrl: 'https://api.channex.io/api/v1',
  timeoutMs: 30_000,
};
