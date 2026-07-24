import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider, EmailResult } from '../email-provider.interface';

/**
 * Development fallback — logs the message instead of sending.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  isConfigured(): boolean {
    return true;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    this.logger.log(
      `[Email:console] → ${message.to} | ${message.subject}\n${message.text.slice(0, 200)}`,
    );
    return {
      sent: false,
      provider: this.name,
      messageId: `console-${Date.now()}`,
      error: 'No email provider configured — message logged only',
    };
  }
}
