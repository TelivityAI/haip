import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider, EmailResult } from '../email-provider.interface';

/**
 * SMTP transport (nodemailer) — configured via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private transport: any = null;

  constructor() {
    this.initTransport();
  }

  private initTransport(): void {
    const host = process.env['SMTP_HOST'];
    const port = process.env['SMTP_PORT'];
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASS'];

    if (!host || !port) {
      this.logger.log('SMTP not configured — email will use the next provider or console fallback');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer');
      this.transport = nodemailer.createTransport({
        host,
        port: parseInt(port, 10),
        secure: parseInt(port, 10) === 465,
        auth: user && pass ? { user, pass } : undefined,
      });
      this.logger.log(`SMTP email provider configured: ${host}:${port}`);
    } catch {
      this.logger.warn('nodemailer not available — SMTP email provider disabled');
    }
  }

  isConfigured(): boolean {
    return this.transport !== null;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (!this.transport) {
      return { sent: false, provider: this.name, error: 'SMTP not configured' };
    }

    try {
      const from = message.from ?? process.env['SMTP_FROM'] ?? 'noreply@haip.dev';
      const info = await this.transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      this.logger.log(`Email sent via SMTP to ${message.to}: ${info.messageId}`);
      return { sent: true, provider: this.name, messageId: info.messageId };
    } catch (error: any) {
      this.logger.error(`SMTP send failed to ${message.to}: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
