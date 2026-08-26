import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider, EmailResult } from '../email-provider.interface';

/**
 * Amazon SES outbound adapter via an explicit HTTPS gateway.
 *
 * Honest path (no forged SigV4): set SES_ENDPOINT + SES_API_KEY + SES_FROM.
 * Point SES_ENDPOINT at LocalStack, a signing sidecar, or a mock.
 *
 * @see docs/integrations/mailgun-ses.md
 */
@Injectable()
export class SesEmailProvider implements EmailProvider {
  readonly name = 'amazon-ses';
  private readonly logger = new Logger(SesEmailProvider.name);
  private readonly from = process.env['SES_FROM'] ?? process.env['AWS_SES_FROM'];
  private readonly endpoint = process.env['SES_ENDPOINT'];
  private readonly apiKey = process.env['SES_API_KEY'];
  private readonly region = process.env['SES_REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1';

  isConfigured(): boolean {
    return Boolean(this.from && this.endpoint && this.apiKey);
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (!this.isConfigured()) {
      return {
        sent: false,
        provider: this.name,
        error: 'Amazon SES gateway not configured (set SES_ENDPOINT + SES_API_KEY + SES_FROM)',
      };
    }

    const payload = {
      FromEmailAddress: message.from ?? this.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject },
          Body: {
            Text: { Data: message.text },
            Html: { Data: message.html },
          },
        },
      },
    };

    try {
      const res = await fetch(`${this.endpoint!.replace(/\/$/, '')}/v2/email/outbound-emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-SES-Region': this.region,
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        MessageId?: string;
        message?: string;
      };
      if (!res.ok) {
        return {
          sent: false,
          provider: this.name,
          error: body.message ?? `SES HTTP ${res.status}`,
        };
      }
      this.logger.log(`Email sent via SES gateway to ${message.to}`);
      return { sent: true, provider: this.name, messageId: body.MessageId };
    } catch (error: any) {
      this.logger.error(`SES send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
