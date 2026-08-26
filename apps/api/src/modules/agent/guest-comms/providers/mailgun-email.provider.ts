import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider, EmailResult } from '../email-provider.interface';

/**
 * Mailgun Messages API adapter.
 *
 * Env: MAILGUN_API_KEY, MAILGUN_DOMAIN, optional MAILGUN_FROM, MAILGUN_API_BASE.
 *
 * @see docs/integrations/mailgun-ses.md
 */
@Injectable()
export class MailgunEmailProvider implements EmailProvider {
  readonly name = 'mailgun';
  private readonly logger = new Logger(MailgunEmailProvider.name);
  private readonly apiKey = process.env['MAILGUN_API_KEY'];
  private readonly domain = process.env['MAILGUN_DOMAIN'];
  private readonly defaultFrom =
    process.env['MAILGUN_FROM'] ?? (this.domain ? `noreply@${this.domain}` : undefined);
  private readonly apiBase = (
    process.env['MAILGUN_API_BASE'] ?? 'https://api.mailgun.net'
  ).replace(/\/$/, '');

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.domain && this.defaultFrom);
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (!this.isConfigured()) {
      return { sent: false, provider: this.name, error: 'Mailgun not configured' };
    }

    const form = new URLSearchParams();
    form.set('from', message.from ?? this.defaultFrom!);
    form.set('to', message.to);
    form.set('subject', message.subject);
    form.set('text', message.text);
    form.set('html', message.html);

    try {
      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
      const res = await fetch(`${this.apiBase}/v3/${this.domain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!res.ok) {
        return {
          sent: false,
          provider: this.name,
          error: payload.message ?? `Mailgun HTTP ${res.status}`,
        };
      }
      this.logger.log(`Email sent via Mailgun to ${message.to}`);
      return { sent: true, provider: this.name, messageId: payload.id };
    } catch (error: any) {
      this.logger.error(`Mailgun send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
