import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider, EmailResult } from '../email-provider.interface';

/**
 * SendGrid Email API reference adapter.
 *
 * Env: SENDGRID_API_KEY (required), SENDGRID_FROM (default sender).
 * Uses fetch — no SendGrid SDK required.
 *
 * @see docs/integrations/sendgrid-email.md
 */
@Injectable()
export class SendgridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid';
  private readonly logger = new Logger(SendgridEmailProvider.name);
  private apiKey?: string;
  private defaultFrom?: string;

  constructor() {
    this.apiKey = process.env['SENDGRID_API_KEY'];
    this.defaultFrom = process.env['SENDGRID_FROM'];
    if (!this.apiKey) {
      this.logger.log('SendGrid not configured — email will fall back to SMTP or console');
    } else if (!this.defaultFrom) {
      this.logger.warn('SENDGRID_API_KEY set but SENDGRID_FROM missing — sends may fail');
    } else {
      this.logger.log('SendGrid email provider configured');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.defaultFrom);
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (!this.isConfigured()) {
      return { sent: false, provider: this.name, error: 'SendGrid not configured' };
    }

    const from = message.from ?? this.defaultFrom!;
    const payload = {
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: from },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
    };

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`SendGrid send failed (${res.status}): ${body}`);
        return { sent: false, provider: this.name, error: `SendGrid HTTP ${res.status}` };
      }

      const messageId = res.headers.get('x-message-id') ?? undefined;
      this.logger.log(`Email sent via SendGrid to ${message.to}`);
      return { sent: true, provider: this.name, messageId };
    } catch (error: any) {
      this.logger.error(`SendGrid send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
