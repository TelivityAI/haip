import { Injectable, Logger } from '@nestjs/common';
import type {
  WhatsAppMessage,
  WhatsAppProvider,
  WhatsAppResult,
} from '../notification-provider.interface';

@Injectable()
export class TwilioWhatsappProvider implements WhatsAppProvider {
  readonly name = 'twilio-whatsapp';
  private readonly logger = new Logger(TwilioWhatsappProvider.name);
  private readonly accountSid = process.env['TWILIO_ACCOUNT_SID'];
  private readonly authToken = process.env['TWILIO_AUTH_TOKEN'];
  private readonly from =
    process.env['TWILIO_WHATSAPP_FROM'] ?? process.env['TWILIO_FROM'];

  isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.from);
  }

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    if (!this.isConfigured()) {
      return {
        sent: false,
        provider: this.name,
        error: 'Twilio WhatsApp not configured',
      };
    }

    if (!message.contentSid && !message.body) {
      return {
        sent: false,
        provider: this.name,
        error: 'Either contentSid or body is required',
      };
    }

    const params = new URLSearchParams();
    params.set('To', this.normalizeAddress(message.to));
    params.set('From', this.normalizeAddress(message.from ?? this.from!));

    if (message.contentSid) {
      params.set('ContentSid', message.contentSid);
      if (message.variables && Object.keys(message.variables).length > 0) {
        params.set('ContentVariables', JSON.stringify(message.variables));
      }
    } else if (message.body) {
      params.set('Body', message.body);
    }

    try {
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params,
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        sid?: string;
      };
      if (!response.ok) {
        return {
          sent: false,
          provider: this.name,
          error: payload?.message ?? `Twilio HTTP ${response.status}`,
        };
      }
      return {
        sent: true,
        provider: this.name,
        messageId: payload?.sid,
      };
    } catch (error: any) {
      this.logger.error(`Twilio WhatsApp send failed: ${error.message}`);
      return {
        sent: false,
        provider: this.name,
        error: error.message,
      };
    }
  }

  private normalizeAddress(value: string): string {
    return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
  }
}
