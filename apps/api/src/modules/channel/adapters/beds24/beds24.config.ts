export interface Beds24Config {
  apiKey: string;
  propKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

export const DEFAULT_BEDS24_CONFIG: Omit<Beds24Config, 'apiKey' | 'propKey'> = {
  baseUrl: 'https://api.beds24.com/json',
  timeoutMs: 30_000,
};
