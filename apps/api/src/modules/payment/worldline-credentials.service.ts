import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  worldlineEnvironment,
  type WorldlineMerchantCredentials,
} from './gateways/worldline-gateway';
import {
  decryptCredentialPlaintext,
  deserializeEncryptedBlob,
  loadMigrationCredentialKeyRingFromEnv,
} from '../../common/crypto/credential-encryption';

/**
 * Resolves merchant id / API key / secret for a property.
 * Prefers an enabled Integrations row (`worldline`), then process env.
 * Invalid ciphertext does not fall back to a different merchant.
 */
@Injectable()
export class WorldlineCredentialsService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
  ) {}

  async resolveForProperty(propertyId: string): Promise<WorldlineMerchantCredentials | null> {
    try {
      await this.integrationsService.protectWorldlineCredentials(propertyId);
      const connection = await this.integrationsService.getPropertyIntegration(propertyId, 'worldline');
      if (connection.enabled) {
        const parsed = this.fromConfig((connection.config ?? {}) as Record<string, unknown>);
        if (parsed) return parsed;
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw new ServiceUnavailableException('Worldline credentials are unavailable');
      }
    }
    return this.fromEnv();
  }

  async webhookSecretForKeyId(keyId: string): Promise<string | null> {
    const trimmed = keyId.trim();
    if (!trimmed) return null;
    const envKey = this.configService.get<string>('WORLDLINE_WEBHOOK_KEY_ID')?.trim();
    const envSecret = this.configService.get<string>('WORLDLINE_WEBHOOK_SECRET')?.trim();
    if (envKey && envSecret && envKey === trimmed) return envSecret;

    const match = await this.integrationsService.findWorldlineWebhookConfig(trimmed);
    if (!match) return null;
    try {
      await this.integrationsService.protectWorldlineCredentials(match.propertyId);
      const connection = await this.integrationsService.getPropertyIntegration(match.propertyId, 'worldline');
      const cfg = (connection.config ?? {}) as Record<string, unknown>;
      return decryptField(cfg, 'webhookSecretEncrypted') ?? stringField(cfg, 'webhookSecret', 'webhook_secret') ?? null;
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw new ServiceUnavailableException('Worldline credentials are unavailable');
    }
  }

  private fromConfig(cfg: Record<string, unknown>): WorldlineMerchantCredentials | null {
    const merchantId = stringField(cfg, 'merchantId', 'merchant_id', 'pspid');
    const apiKeyId = stringField(cfg, 'apiKeyId', 'api_key_id');
    const secretApiKey = decryptField(cfg, 'secretApiKeyEncrypted')
      ?? stringField(cfg, 'secretApiKey', 'secret_api_key');
    if (!merchantId || !apiKeyId || !secretApiKey) return null;
    return {
      merchantId,
      apiKeyId,
      secretApiKey,
      environment: worldlineEnvironment(stringField(cfg, 'environment', 'env')),
    };
  }

  private fromEnv(): WorldlineMerchantCredentials | null {
    const merchantId = this.configService.get<string>('WORLDLINE_MERCHANT_ID')?.trim();
    const apiKeyId = this.configService.get<string>('WORLDLINE_API_KEY_ID')?.trim();
    const secretApiKey = this.configService.get<string>('WORLDLINE_SECRET_API_KEY')?.trim();
    if (!merchantId || !apiKeyId || !secretApiKey) return null;
    return {
      merchantId,
      apiKeyId,
      secretApiKey,
      environment: worldlineEnvironment(this.configService.get<string>('WORLDLINE_ENV', 'test')),
    };
  }
}

function decryptField(cfg: Record<string, unknown>, key: string): string | undefined {
  const blob = cfg[key];
  if (!blob || typeof blob !== 'object') return undefined;
  return decryptCredentialPlaintext(
    deserializeEncryptedBlob(JSON.stringify(blob)),
    loadMigrationCredentialKeyRingFromEnv(),
  );
}

function stringField(cfg: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = cfg[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
