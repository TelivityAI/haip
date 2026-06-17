import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider, SmsResult } from '../notification-provider.interface';

/**
 * Development/demo SMS fallback — logs the message instead of sending.
 *
 * Always "configured" so the platform never hard-fails when no real SMS provider
 * is set up. It reports `sent:false` (with a console message id) so callers can
 * distinguish a logged-only message from a delivered one.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  isConfigured(): boolean {
    return true;
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    this.logger.log(`[SMS:console] → ${message.to}: ${message.body}`);
    return {
      sent: false,
      provider: this.name,
      messageId: `console-${Date.now()}`,
      error: 'No SMS provider configured — message logged only',
    };
  }
}
