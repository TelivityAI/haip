import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider, SmsResult } from '../notification-provider.interface';

/**
 * Twilio SMS reference adapter.
 *
 * Configured via env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
 * The `twilio` package is loaded dynamically so it stays an OPTIONAL dependency —
 * a self-hoster who doesn't use SMS doesn't have to install it. If the package
 * or the credentials are absent, the provider reports `isConfigured()===false`
 * and the NotificationService falls back to the console provider.
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private client: any = null;
  private from?: string;

  constructor() {
    this.init();
  }

  private init(): void {
    const sid = process.env['TWILIO_ACCOUNT_SID'];
    const token = process.env['TWILIO_AUTH_TOKEN'];
    this.from = process.env['TWILIO_FROM'];

    if (!sid || !token || !this.from) {
      this.logger.log('Twilio not configured — SMS will fall back to console provider');
      return;
    }

    try {
      // Dynamic require to avoid a hard dependency on the twilio SDK.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const twilio = require('twilio');
      this.client = twilio(sid, token);
      this.logger.log('Twilio SMS provider configured');
    } catch {
      this.logger.warn('twilio package not installed — SMS will fall back to console provider');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    if (!this.client) {
      return { sent: false, provider: this.name, error: 'Twilio not configured' };
    }
    try {
      const res = await this.client.messages.create({
        to: message.to,
        from: message.from ?? this.from,
        body: message.body,
      });
      return { sent: true, provider: this.name, messageId: res.sid };
    } catch (error: any) {
      this.logger.error(`Twilio send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
