import { Injectable, Logger } from '@nestjs/common';
import type {
  WhatsAppMessage,
  WhatsAppProvider,
  WhatsAppResult,
} from '../notification-provider.interface';

/**
 * Meta WhatsApp Cloud API adapter.
 *
 * Env: WHATSAPP_CLOUD_TOKEN, WHATSAPP_CLOUD_PHONE_NUMBER_ID,
 * optional WHATSAPP_CLOUD_API_VERSION (default v21.0).
 *
 * @see docs/integrations/whatsapp-cloud.md
 */
@Injectable()
export class WhatsappCloudProvider implements WhatsAppProvider {
  readonly name = 'whatsapp-cloud';
  private readonly logger = new Logger(WhatsappCloudProvider.name);
  private readonly token = process.env['WHATSAPP_CLOUD_TOKEN'];
  private readonly phoneNumberId = process.env['WHATSAPP_CLOUD_PHONE_NUMBER_ID'];
  private readonly apiVersion = process.env['WHATSAPP_CLOUD_API_VERSION'] ?? 'v21.0';

  isConfigured(): boolean {
    return Boolean(this.token && this.phoneNumberId);
  }

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    if (!this.isConfigured()) {
      return {
        sent: false,
        provider: this.name,
        error: 'WhatsApp Cloud not configured',
      };
    }

    const to = message.to.replace(/^whatsapp:/i, '').replace(/^\+/, '');
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
    };

    if (message.body) {
      body['type'] = 'text';
      body['text'] = { body: message.body };
    } else if (message.contentSid) {
      body['type'] = 'template';
      body['template'] = {
        name: message.contentSid,
        language: { code: 'en' },
      };
    } else {
      return {
        sent: false,
        provider: this.name,
        error: 'Either body or contentSid (template name) is required',
      };
    }

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          sent: false,
          provider: this.name,
          error: payload.error?.message ?? `WhatsApp Cloud HTTP ${res.status}`,
        };
      }
      return {
        sent: true,
        provider: this.name,
        messageId: payload.messages?.[0]?.id,
      };
    } catch (error: any) {
      this.logger.error(`WhatsApp Cloud send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
