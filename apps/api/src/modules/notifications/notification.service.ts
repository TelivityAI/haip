import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
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

  // In-memory per-property SMS quota (interim, single-instance). SMS is a billable
  // outbound action with a free-form destination, so an authenticated front-desk
  // user could otherwise drive the property's Twilio account to arbitrary/premium
  // numbers (toll fraud / spam relay). Tunable via env.
  private readonly smsHits = new Map<string, { count: number; resetAt: number }>();
  private assertSmsQuota(propertyId: string): void {
    // Robust parsing: an INVALID env value falls back to the safe default (the
    // limiter stays ON — no fail-open on config drift). Only an explicit, valid
    // value <= 0 disables it.
    const rawMax = Number(process.env['SMS_RATE_LIMIT_MAX']);
    const max = Number.isFinite(rawMax) ? rawMax : 60;
    if (max <= 0) return; // explicitly disabled by the operator
    const rawWindow = Number(process.env['SMS_RATE_LIMIT_WINDOW_MS']);
    const windowMs = Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : 3_600_000;
    const now = Date.now();
    const entry = this.smsHits.get(propertyId);
    if (!entry || now >= entry.resetAt) {
      this.smsHits.set(propertyId, { count: 1, resetAt: now + windowMs });
      return;
    }
    entry.count++;
    if (entry.count > max) {
      throw new HttpException('SMS rate limit exceeded for this property', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Send an SMS to a guest and record the dispatch against the property.
   * Never throws on send failure — returns a structured result so callers
   * (e.g. the guest-comms agent) can decide whether to retry or escalate.
   */
  async sendSms(propertyId: string, to: string, body: string): Promise<SmsResult> {
    this.assertSmsQuota(propertyId);
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
