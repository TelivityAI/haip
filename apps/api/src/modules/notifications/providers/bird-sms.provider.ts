import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider, SmsResult } from '../notification-provider.interface';

/**
 * Bird (MessageBird) SMS reference adapter.
 *
 * Env: BIRD_ACCESS_KEY (or MESSAGEBIRD_ACCESS_KEY), BIRD_ORIGINATOR (sender id / number).
 *
 * @see docs/integrations/bird-sms.md
 */
@Injectable()
export class BirdSmsProvider implements SmsProvider {
  readonly name = 'bird';
  private readonly logger = new Logger(BirdSmsProvider.name);
  private accessKey?: string;
  private originator?: string;

  constructor() {
    this.accessKey =
      process.env['BIRD_ACCESS_KEY'] ?? process.env['MESSAGEBIRD_ACCESS_KEY'];
    this.originator = process.env['BIRD_ORIGINATOR'] ?? process.env['MESSAGEBIRD_ORIGINATOR'];

    if (!this.accessKey || !this.originator) {
      this.logger.log('Bird not configured — SMS will fall back to the next provider');
    } else {
      this.logger.log('Bird SMS provider configured');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.accessKey && this.originator);
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    if (!this.isConfigured()) {
      return { sent: false, provider: this.name, error: 'Bird not configured' };
    }

    try {
      const res = await fetch('https://rest.messagebird.com/messages', {
        method: 'POST',
        headers: {
          Authorization: `AccessKey ${this.accessKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originator: message.from ?? this.originator,
          recipients: [message.to],
          body: message.body,
        }),
      });

      const data = (await res.json()) as { id?: string; errors?: Array<{ description?: string }> };

      if (!res.ok) {
        const err = data.errors?.[0]?.description ?? `HTTP ${res.status}`;
        this.logger.error(`Bird send failed: ${err}`);
        return { sent: false, provider: this.name, error: err };
      }

      return { sent: true, provider: this.name, messageId: data.id };
    } catch (error: any) {
      this.logger.error(`Bird send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
