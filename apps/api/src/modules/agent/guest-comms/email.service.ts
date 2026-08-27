import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  EmailMessage,
  EmailProvider,
  EmailResult,
  EmailSendOptions,
} from './email-provider.interface';
import { EMAIL_PROVIDERS } from './email-provider.interface';

export type { EmailMessage, EmailResult, EmailSendOptions } from './email-provider.interface';

const DEFAULT_EMAIL_SEND_MAX_ATTEMPTS = 3;
const EMAIL_SEND_RETRY_BASE_DELAY_MS = 250;

/**
 * Email transport service — SendGrid, Mailgun, SES gateway, SMTP, or console fallback.
 *
 * Provider order: first configured among SendGrid → Mailgun → SES → SMTP, else console.
 * Automatically retries definitely-not-sent failures only; never auto-retries
 * `outcomeUnknown` (provider may have accepted mail before the response was lost).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@Inject(EMAIL_PROVIDERS) private readonly providers: EmailProvider[]) {}

  isConfigured(): boolean {
    return this.providers.some((p) => p.name !== 'console' && p.isConfigured());
  }

  async send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailResult> {
    const provider = this.activeProvider();
    const maxAttempts = Math.max(1, Math.floor(options?.maxAttempts ?? DEFAULT_EMAIL_SEND_MAX_ATTEMPTS));
    let lastResult: EmailResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const raw = await provider.send(message, options);
      lastResult = raw.provider ? raw : { ...raw, provider: provider.name };

      if (lastResult.status !== 'notSent' || attempt === maxAttempts) {
        break;
      }

      this.logger.warn(
        `Email to ${message.to} not delivered via ${lastResult.provider} (attempt ${attempt}/${maxAttempts}): ${lastResult.error}; retrying`,
      );
      await this.retryDelay(attempt);
    }

    const result = lastResult!;
    if (result.status === 'notSent') {
      this.logger.warn(`Email to ${message.to} not delivered via ${result.provider}: ${result.error}`);
    } else if (result.status === 'outcomeUnknown') {
      this.logger.warn(
        `Email to ${message.to} outcome unknown via ${result.provider}: ${result.error} — not auto-retrying`,
      );
    }
    return result;
  }

  private async retryDelay(attempt: number): Promise<void> {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, EMAIL_SEND_RETRY_BASE_DELAY_MS * attempt);
      timer.unref?.();
    });
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
