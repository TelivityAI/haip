import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider, SmsResult } from '../notification-provider.interface';

const DEFAULT_VONAGE_MESSAGES_URL = 'https://api.nexmo.com/v1/messages';

/**
 * Vonage Messages API reference adapter (SMS channel).
 *
 * Env: `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_SMS_FROM`, optional `VONAGE_MESSAGES_URL`.
 */
@Injectable()
export class VonageSmsProvider implements SmsProvider {
  readonly name = 'vonage';
  private readonly logger = new Logger(VonageSmsProvider.name);
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly from?: string;
  private readonly messagesUrl: string;

  constructor() {
    this.apiKey = process.env['VONAGE_API_KEY']?.trim();
    this.apiSecret = process.env['VONAGE_API_SECRET']?.trim();
    this.from = process.env['VONAGE_SMS_FROM']?.trim();
    this.messagesUrl = (
      process.env['VONAGE_MESSAGES_URL']?.trim() || DEFAULT_VONAGE_MESSAGES_URL
    ).replace(/\/$/, '');
    if (!this.isConfigured()) {
      this.logger.log('Vonage not configured — SMS will not use Vonage until credentials are set');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.from);
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    if (!this.apiKey || !this.apiSecret || !this.from) {
      return { sent: false, provider: this.name, error: 'Vonage not configured' };
    }

    const payload = {
      message_type: 'text',
      text: message.body,
      to: message.to.replace(/^\+/, ''),
      from: message.from ?? this.from,
      channel: 'sms',
    };

    try {
      const auth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
      const response = await fetch(this.messagesUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as {
        message_uuid?: string;
        title?: string;
        detail?: string;
      };

      if (!response.ok) {
        const detail = data.detail ?? data.title ?? `Vonage HTTP ${response.status}`;
        return { sent: false, provider: this.name, error: detail };
      }

      return {
        sent: true,
        provider: this.name,
        messageId: data.message_uuid,
      };
    } catch (error: any) {
      this.logger.error(`Vonage send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
