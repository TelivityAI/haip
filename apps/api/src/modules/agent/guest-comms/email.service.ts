import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider, EmailResult } from './email-provider.interface';
import { EMAIL_PROVIDERS } from './email-provider.interface';

export type { EmailMessage, EmailResult } from './email-provider.interface';

/**
 * Email transport service — SendGrid, SMTP, or console fallback.
 *
 * Provider order: SendGrid (when configured), then SMTP, then console (logged only).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@Inject(EMAIL_PROVIDERS) private readonly providers: EmailProvider[]) {}

  isConfigured(): boolean {
    return this.providers.some((p) => p.name !== 'console' && p.isConfigured());
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const provider = this.activeProvider();
    const result = await provider.send(message);
    if (!result.provider) {
      return { ...result, provider: provider.name };
    }
    if (!result.sent) {
      this.logger.warn(`Email to ${message.to} not delivered via ${result.provider}: ${result.error}`);
    }
    return result;
  }

  private activeProvider(): EmailProvider {
    const real = this.providers.find((p) => p.name !== 'console' && p.isConfigured());
    if (real) return real;

    const fallback = this.providers.find((p) => p.isConfigured());
    if (!fallback) {
      throw new Error('No email provider is configured');
    }
    return fallback;
  }
}
