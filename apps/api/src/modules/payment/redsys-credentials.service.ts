import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../integrations/integrations.service';
import type { RedsysMerchantCredentials } from './gateways/redsys-gateway';

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
        const secretKey = stringField(cfg, 'secretKey', 'secret_key', 'clave');
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
    } catch {
      // Catalog row may be missing before seed — fall through to env.
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
    const base =
      this.configService.get<string>('PUBLIC_API_BASE_URL')?.trim() ||
      this.configService.get<string>('API_BASE_URL')?.trim() ||
      'http://localhost:3000';
    return base.replace(/\/$/, '');
  }

  merchantNotificationUrl(): string {
    return `${this.publicApiBaseUrl()}/api/v1/webhooks/redsys`;
  }
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
