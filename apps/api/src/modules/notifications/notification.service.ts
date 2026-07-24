import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { guests, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import type {
  SmsProvider,
  SmsResult,
  TelegramMessage,
  TelegramProvider,
  TelegramResult,
  WhatsAppMessage,
  WhatsAppProvider,
  WhatsAppResult,
} from './notification-provider.interface';
import { SMS_PROVIDER, TELEGRAM_PROVIDER, WHATSAPP_PROVIDERS } from './notification-provider.interface';

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
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(TELEGRAM_PROVIDER) private readonly telegramProvider: TelegramProvider,
    @Inject(WHATSAPP_PROVIDERS) private readonly whatsappProviders: WhatsAppProvider[],
    private readonly webhooks: WebhookService,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  /** The active WhatsApp provider: Twilio when configured, else console. */
  private whatsappProvider(): WhatsAppProvider {
    return this.pickProvider(this.whatsappProviders);
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
    const result = await this.smsProvider.send({ to, body });

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

  async sendWhatsAppTemplate(
    propertyId: string,
    message: WhatsAppMessage,
    opts?: { guestId?: string; marketing?: boolean },
  ): Promise<WhatsAppResult> {
    if (opts?.marketing) {
      if (!opts.guestId) {
        throw new BadRequestException('guestId is required for marketing WhatsApp messages');
      }
      const guest = await this.findGuestAtProperty(opts.guestId, propertyId);
      if (!guest.gdprConsentMarketing) {
        throw new ForbiddenException('Guest has not consented to marketing messages');
      }
    }

    const provider = this.whatsappProvider();
    const result = await provider.send(message);

    await this.webhooks.emit(
      'guest.communication_sent',
      'notification',
      opts?.guestId ?? message.to,
      {
        channel: 'whatsapp',
        provider: result.provider,
        success: result.sent,
        marketing: opts?.marketing === true,
        ...(result.error ? { error: result.error } : {}),
      },
      propertyId,
    );

    if (!result.sent) {
      this.logger.warn(
        `WhatsApp to ${message.to} not delivered via ${result.provider}: ${result.error}`,
      );
    }

    return result;
  }

  async sendTelegram(
    propertyId: string,
    to: string,
    body: string,
    opts?: { parseMode?: TelegramMessage['parseMode'] },
  ): Promise<TelegramResult> {
    this.assertSmsQuota(propertyId);
    const result = await this.telegramProvider.send({
      to,
      body,
      parseMode: opts?.parseMode,
    });

    await this.webhooks.emit(
      'guest.communication_sent',
      'notification',
      to,
      {
        channel: 'telegram',
        provider: result.provider,
        success: result.sent,
        ...(result.error ? { error: result.error } : {}),
      },
      propertyId,
    );

    if (!result.sent) {
      this.logger.warn(`Telegram to ${to} not delivered via ${result.provider}: ${result.error}`);
    }
    return result;
  }

  private pickProvider<T extends { name: string; isConfigured(): boolean }>(providers: T[]): T {
    const realProvider = providers.find((provider) => provider.name !== 'console' && provider.isConfigured());
    if (realProvider) return realProvider;

    const fallback = providers.find((provider) => provider.isConfigured());
    if (!fallback) {
      throw new HttpException('No notification provider is configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return fallback;
  }

  private async findGuestAtProperty(guestId: string, propertyId: string) {
    // Guests are cross-property; API access must prove the guest is linked to the
    // requesting property via at least one reservation before reading the row.
    const [reservation] = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.guestId, guestId), eq(reservations.propertyId, propertyId)))
      .limit(1);
    if (!reservation) {
      throw new ForbiddenException('guestId is not linked to this property');
    }

    const [guest] = await this.db
      .select({ id: guests.id, gdprConsentMarketing: guests.gdprConsentMarketing })
      .from(guests)
      .where(eq(guests.id, guestId));
    if (!guest) {
      throw new NotFoundException(`Guest ${guestId} not found`);
    }
    return guest;
  }
}
