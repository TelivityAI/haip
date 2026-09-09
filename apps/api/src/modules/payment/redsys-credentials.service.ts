import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../integrations/integrations.service';
import type { RedsysMerchantCredentials } from './gateways/redsys-gateway';
import { decryptCredentialPlaintext, deserializeEncryptedBlob, loadMigrationCredentialKeyRingFromEnv } from '../../common/crypto/credential-encryption';

/**
 * Resolves Redsys FUC / terminal / secret for a property.
 * Prefers enabled Integrations catalog config (`redsys`), then process env.
 */
@Injectable()
export class RedsysCredentialsService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
  ) {}

  async resolveForProperty(
    propertyId: string,
  ): Promise<RedsysMerchantCredentials | null> {
    try {
      await this.integrationsService.protectRedsysCredentials(propertyId);
      const connection = await this.integrationsService.getPropertyIntegration(
        propertyId,
        'redsys',
      );
      if (connection.enabled) {
        const cfg = (connection.config ?? {}) as Record<string, unknown>;
        const merchantCode = stringField(
          cfg,
          'merchantCode',
          'merchant_code',
          'fuc',
        );
        const secretKey = cfg['secretKeyEncrypted']
          ? decryptCredentialPlaintext(deserializeEncryptedBlob(JSON.stringify(cfg['secretKeyEncrypted'])), loadMigrationCredentialKeyRingFromEnv())
          : stringField(cfg, 'secretKey', 'secret_key', 'clave');
        const terminal = stringField(cfg, 'terminal') || '001';
        const environmentRaw = (
          stringField(cfg, 'environment', 'env') || 'test'
        ).toLowerCase();
        if (merchantCode && secretKey) {
          return {
            merchantCode,
            terminal,
            secretKey,
            environment: environmentRaw === 'live' ? 'live' : 'test',
          };
        }
      }
    } catch (error) {
      // Only a missing catalog permits env fallback. Invalid ciphertext, missing
      // encryption keys or database errors must never select a different merchant.
      if (!(error instanceof NotFoundException)) {
        throw new ServiceUnavailableException('Redsys credentials are unavailable');
      }
    }

    const merchantCode = this.configService
      .get<string>('REDSYS_MERCHANT_CODE')
      ?.trim();
    const secretKey = this.configService.get<string>('REDSYS_SECRET_KEY')?.trim();
    const terminal =
      this.configService.get<string>('REDSYS_TERMINAL')?.trim() || '001';
    const environmentRaw = this.configService
      .get<string>('REDSYS_ENV', 'test')
      ?.trim()
      .toLowerCase();

    if (!merchantCode || !secretKey) return null;
    return {
      merchantCode,
      terminal,
      secretKey,
      environment: environmentRaw === 'live' ? 'live' : 'test',
    };
  }

  publicApiBaseUrl(): string {
    return publicApiBaseUrl(this.configService);
  }

  merchantNotificationUrl(): string {
    return `${this.publicApiBaseUrl()}/api/v1/webhooks/redsys`;
  }
}

/** Shared trusted origin/prefix for the provider notification and browser relay. */
export function publicApiBaseUrl(config: ConfigService): string {
  const base = config.get<string>('PUBLIC_API_BASE_URL')?.trim()
    || config.get<string>('API_BASE_URL')?.trim() || 'http://localhost:3000';
  return base.replace(/\/$/, '');
}

function stringField(
  cfg: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = cfg[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
