import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService, worldlineConfigHasPlaintextSecret } from '../integrations/integrations.service';
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
      const connection = await this.integrationsService.getPropertyIntegration(propertyId, 'worldline');
      if (connection.enabled) {
        const cfg = (connection.config ?? {}) as Record<string, unknown>;
        if (worldlineConfigHasPlaintextSecret(cfg)) {
          await this.integrationsService.protectWorldlineCredentials(propertyId);
          const refreshed = await this.integrationsService.getPropertyIntegration(propertyId, 'worldline');
          const parsed = this.fromConfig((refreshed.config ?? {}) as Record<string, unknown>);
          if (parsed) return parsed;
        } else {
          const parsed = this.fromConfig(cfg);
          if (parsed) return parsed;
        }
      }
    } catch (error) {
      // A stored row that cannot be read must not fall back to another merchant.
      if (!(error instanceof NotFoundException)) return null;
    }
    return this.fromEnv();
  }

  /**
   * Secret for a webhook key id, plus the property and merchant that own it.
   * An operator env key has no property id. A property key never verifies
   * another property's payments.
   */
  async webhookSecretForKeyId(keyId: string): Promise<{
    secret: string;
    propertyId: string | null;
    merchantId: string;
  } | null> {
    const trimmed = keyId.trim();
    if (!trimmed) return null;
    const envKey = this.configService.get<string>('WORLDLINE_WEBHOOK_KEY_ID')?.trim();
    const envSecret = this.configService.get<string>('WORLDLINE_WEBHOOK_SECRET')?.trim();
    const envMerchant = this.configService.get<string>('WORLDLINE_MERCHANT_ID')?.trim();
    if (envKey && envSecret && envMerchant && envKey === trimmed) {
      return { secret: envSecret, propertyId: null, merchantId: envMerchant };
    }

    const match = await this.integrationsService.findWorldlineWebhookConfig(trimmed);
    if (!match) return null;
    try {
      let cfg = match.config;
      if (worldlineConfigHasPlaintextSecret(cfg)) {
        await this.integrationsService.protectWorldlineCredentials(match.propertyId);
        const connection = await this.integrationsService.getPropertyIntegration(match.propertyId, 'worldline');
        cfg = (connection.config ?? {}) as Record<string, unknown>;
      }
      const secret = decryptField(cfg, 'webhookSecretEncrypted') ?? stringField(cfg, 'webhookSecret', 'webhook_secret');
      const merchantId = stringField(cfg, 'merchantId', 'merchant_id', 'pspid');
      if (!secret || !merchantId) return null;
      return { secret, propertyId: match.propertyId, merchantId };
    } catch {
      return null;
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
