import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const DEV_FALLBACK = 'dev-check-in-secret-change-me';

/**
 * Resolve the HMAC secret for guest check-in magic links.
 * Production fails closed if CHECK_IN_MAGIC_SECRET (or JWT/SESSION) is unset.
 */
export function resolveCheckInMagicSecret(config: ConfigService): string {
  const secret =
    config.get<string>('CHECK_IN_MAGIC_SECRET') ||
    config.get<string>('JWT_SECRET') ||
    config.get<string>('SESSION_SECRET');

  const isProd = config.get<string>('NODE_ENV') === 'production';
  if (!secret || secret === DEV_FALLBACK) {
    if (isProd) {
      throw new InternalServerErrorException(
        'CHECK_IN_MAGIC_SECRET must be set in production',
      );
    }
    return secret || DEV_FALLBACK;
  }
  return secret;
}
