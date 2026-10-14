import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { WorldlineCredentialsService } from './worldline-credentials.service';

describe('WorldlineCredentialsService', () => {
  it('uses process env only when the catalog row is absent', async () => {
    const integrations = {
      protectWorldlineCredentials: vi.fn().mockRejectedValue(new NotFoundException('missing')),
      getPropertyIntegration: vi.fn(),
      findWorldlineWebhookConfig: vi.fn(),
    };
    const config = {
      get: (key: string) => ({
        WORLDLINE_MERCHANT_ID: 'psp-env',
        WORLDLINE_API_KEY_ID: 'key-env',
        WORLDLINE_SECRET_API_KEY: 'secret-env',
        WORLDLINE_ENV: 'live',
      })[key],
    };
    const service = new WorldlineCredentialsService(integrations as any, config as any);
    await expect(service.resolveForProperty('prop-1')).resolves.toEqual({
      merchantId: 'psp-env',
      apiKeyId: 'key-env',
      secretApiKey: 'secret-env',
      environment: 'live',
    });
  });

  it('does not fall back to env when stored ciphertext cannot be read', async () => {
    const integrations = {
      protectWorldlineCredentials: vi.fn().mockRejectedValue(new Error('bad key')),
      getPropertyIntegration: vi.fn(),
    };
    const config = {
      get: (key: string) => ({
        WORLDLINE_MERCHANT_ID: 'other-merchant',
        WORLDLINE_API_KEY_ID: 'other-key',
        WORLDLINE_SECRET_API_KEY: 'other-secret',
      })[key],
    };
    const service = new WorldlineCredentialsService(integrations as any, config as any);
    await expect(service.resolveForProperty('prop-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
