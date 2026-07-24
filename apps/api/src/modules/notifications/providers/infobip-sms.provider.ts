import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider, SmsResult } from '../notification-provider.interface';

const DEFAULT_INFOBIP_BASE = 'https://api.infobip.com';

/**
 * Infobip SMS reference adapter (Messages API — advanced text).
 *
 * Env: `INFOBIP_API_KEY`, `INFOBIP_SMS_FROM`, optional `INFOBIP_BASE_URL`.
 */
@Injectable()
export class InfobipSmsProvider implements SmsProvider {
  readonly name = 'infobip';
  private readonly logger = new Logger(InfobipSmsProvider.name);
  private readonly apiKey?: string;
  private readonly from?: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env['INFOBIP_API_KEY']?.trim();
    this.from = process.env['INFOBIP_SMS_FROM']?.trim();
    this.baseUrl = (process.env['INFOBIP_BASE_URL']?.trim() || DEFAULT_INFOBIP_BASE).replace(
      /\/$/,
      '',
    );
    if (!this.isConfigured()) {
      this.logger.log('Infobip not configured — SMS will not use Infobip until credentials are set');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.from);
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    if (!this.apiKey || !this.from) {
      return { sent: false, provider: this.name, error: 'Infobip not configured' };
    }

    const body = {
      messages: [
        {
          from: message.from ?? this.from,
          destinations: [{ to: message.to }],
          text: message.body,
        },
      ],
    };

    try {
      const response = await fetch(`${this.baseUrl}/sms/2/text/advanced`, {
        method: 'POST',
        headers: {
          Authorization: `App ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ messageId?: string; status?: { description?: string } }>;
        requestError?: { serviceException?: { text?: string } };
      };

      if (!response.ok) {
        const detail =
          payload?.requestError?.serviceException?.text ?? `Infobip HTTP ${response.status}`;
        return { sent: false, provider: this.name, error: detail };
      }

      const messageId = payload.messages?.[0]?.messageId;
      return { sent: true, provider: this.name, messageId };
    } catch (error: any) {
      this.logger.error(`Infobip send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
