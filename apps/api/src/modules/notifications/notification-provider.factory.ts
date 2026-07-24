import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SMS_PROVIDERS,
  TELEGRAM_PROVIDERS,
  type SmsProvider,
  type TelegramProvider,
} from './notification-provider.interface';

const SMS_AUTO_ORDER = ['twilio', 'infobip', 'vonage'] as const;

/**
 * Selects SMS and Telegram adapters from env and registered providers.
 *
 * `SMS_PROVIDER` — `twilio`, `infobip`, `vonage`, or `console`. When unset, the first
 * configured vendor in twilio → infobip → vonage order is used, else console.
 *
 * `TELEGRAM_PROVIDER` — `telegram` or `console` (default `telegram` when unset).
 */
@Injectable()
export class NotificationProviderFactory {
  private readonly logger = new Logger(NotificationProviderFactory.name);
  private smsResolved?: SmsProvider;
  private telegramResolved?: TelegramProvider;

  constructor(
    @Inject(SMS_PROVIDERS) private readonly smsProviders: SmsProvider[],
    @Inject(TELEGRAM_PROVIDERS) private readonly telegramProviders: TelegramProvider[],
  ) {}

  resolveSms(): SmsProvider {
    if (this.smsResolved) return this.smsResolved;

    const byName = new Map(this.smsProviders.map((p) => [p.name, p]));
    const requested = process.env['SMS_PROVIDER']?.trim().toLowerCase().replace(/-/g, '_');

    if (requested) {
      const chosen = byName.get(requested);
      if (chosen?.isConfigured()) {
        this.smsResolved = chosen;
        this.logger.log(`SMS provider: ${chosen.name}`);
        return chosen;
      }
      if (chosen && !chosen.isConfigured()) {
        this.logger.warn(
          `SMS provider "${requested}" is not configured — falling back to console adapter`,
        );
      } else if (!chosen) {
        this.logger.warn(`Unknown SMS_PROVIDER "${requested}" — falling back to console adapter`);
      }
      this.smsResolved = this.requireConsoleSms(byName);
      return this.smsResolved;
    }

    for (const name of SMS_AUTO_ORDER) {
      const candidate = byName.get(name);
      if (candidate?.isConfigured()) {
        this.smsResolved = candidate;
        this.logger.log(`SMS provider: ${candidate.name} (auto)`);
        return candidate;
      }
    }

    this.smsResolved = this.requireConsoleSms(byName);
    return this.smsResolved;
  }

  resolveTelegram(): TelegramProvider {
    if (this.telegramResolved) return this.telegramResolved;

    const byName = new Map(this.telegramProviders.map((p) => [p.name, p]));
    const requested = (
      process.env['TELEGRAM_PROVIDER']?.trim().toLowerCase() || 'telegram'
    ).replace(/-/g, '_');
    const chosen = byName.get(requested);

    if (chosen?.isConfigured()) {
      this.telegramResolved = chosen;
      this.logger.log(`Telegram provider: ${chosen.name}`);
      return chosen;
    }

    if (chosen && !chosen.isConfigured()) {
      this.logger.warn(
        `Telegram provider "${requested}" is not configured — falling back to console adapter`,
      );
    } else if (!chosen) {
      this.logger.warn(
        `Unknown TELEGRAM_PROVIDER "${requested}" — falling back to console adapter`,
      );
    }

    const consoleProvider = byName.get('console');
    if (consoleProvider) {
      this.telegramResolved = consoleProvider;
      return consoleProvider;
    }

    throw new Error('No Telegram providers registered');
  }

  private requireConsoleSms(byName: Map<string, SmsProvider>): SmsProvider {
    const consoleProvider = byName.get('console');
    if (consoleProvider) return consoleProvider;
    throw new Error('No SMS providers registered');
  }
}
