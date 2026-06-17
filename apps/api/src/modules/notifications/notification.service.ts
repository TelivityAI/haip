import { Injectable, Logger } from '@nestjs/common';
import { WebhookService } from '../webhook/webhook.service';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import type { SmsProvider, SmsResult } from './notification-provider.interface';

/**
 * Outbound guest-notification dispatcher (SMS).
 *
 * Picks the first configured real provider (Twilio), otherwise the console
 * fallback. Every dispatch is audited via the webhook/audit trail, scoped to
 * `propertyId` — multi-tenancy applies to side-effects too, not just rows.
 *
 * Email is handled by the existing EmailService (SMTP, agent module); this
 * service covers the SMS gap and provides the provider abstraction for it.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly twilio: TwilioSmsProvider,
    private readonly console: ConsoleSmsProvider,
    private readonly webhooks: WebhookService,
  ) {}

  /** The active SMS provider: Twilio when configured, else the console fallback. */
  private smsProvider(): SmsProvider {
    return this.twilio.isConfigured() ? this.twilio : this.console;
  }

  /**
   * Send an SMS to a guest and record the dispatch against the property.
   * Never throws on send failure — returns a structured result so callers
   * (e.g. the guest-comms agent) can decide whether to retry or escalate.
   */
  async sendSms(propertyId: string, to: string, body: string): Promise<SmsResult> {
    const provider = this.smsProvider();
    const result = await provider.send({ to, body });

    // Audit the dispatch attempt, scoped to the tenant. Reuses the existing
    // guest.communication_sent event (entity.action pattern).
    await this.webhooks.emit(
      'guest.communication_sent',
      'notification',
      to,
      {
        channel: 'sms',
        provider: result.provider,
        success: result.sent,
        ...(result.error ? { error: result.error } : {}),
      },
      propertyId,
    );

    if (!result.sent) {
      this.logger.warn(`SMS to ${to} not delivered via ${result.provider}: ${result.error}`);
    }
    return result;
  }
}
