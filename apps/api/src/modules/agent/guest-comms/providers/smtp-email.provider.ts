import { Injectable, Logger } from '@nestjs/common';
import type {
  EmailMessage,
  EmailProvider,
  EmailResult,
  EmailSendOptions,
} from '../email-provider.interface';
import {
  emailSendTimeoutMs,
  unknownTimeoutResult,
} from './bounded-email-transport';

interface OwnedSmtpPoolResource {
  connection?: {
    _socket?: OwnedSmtpConnectionSocket;
  };
  close?: () => void;
}

interface OwnedSmtpSocket {
  destroyed?: boolean;
  destroy?: () => void;
}

interface OwnedSmtpConnectionSocket extends OwnedSmtpSocket {
  socket?: OwnedSmtpSocket;
}

interface OwnedSmtpTransport {
  close?: () => void;
  transporter?: {
    _connections?: OwnedSmtpPoolResource[];
  };
  sendMail: (message: Record<string, unknown>) => Promise<{ messageId: string }>;
}

/**
 * SMTP transport (nodemailer) — configured via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private nodemailer: any = null;
  private transportConfig: Record<string, unknown> | null = null;

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
      this.nodemailer = nodemailer;
      this.transportConfig = {
        host,
        port: parseInt(port, 10),
        secure: parseInt(port, 10) === 465,
        auth: user && pass ? { user, pass } : undefined,
      };
      this.logger.log(`SMTP email provider configured: ${host}:${port}`);
    } catch {
      this.logger.warn('nodemailer not available — SMTP email provider disabled');
    }
  }

  isConfigured(): boolean {
    return this.nodemailer !== null && this.transportConfig !== null;
  }

  async send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailResult> {
    if (!this.isConfigured()) {
      return { sent: false, provider: this.name, error: 'SMTP not configured' };
    }

    const timeoutMs = emailSendTimeoutMs(options);
    const transport = this.nodemailer.createTransport({
      ...this.transportConfig,
      pool: true,
      maxConnections: 1,
      maxMessages: 1,
      maxRequeues: 0,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
      dnsTimeout: timeoutMs,
    }) as OwnedSmtpTransport;
    let timedOut = false;
    let lateClose: ReturnType<typeof setImmediate> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      this.closeOwnedTransport(transport);
      // Pool resource setup itself is asynchronous. Re-close on the next turn
      // so a resource created at the deadline cannot outlive this send.
      lateClose = setImmediate(() => this.closeOwnedTransport(transport));
      lateClose.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    try {
      const from = message.from ?? process.env['SMTP_FROM'] ?? 'noreply@haip.dev';
      const info = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId,
        headers: message.idempotencyKey
          ? { 'X-HAIP-Idempotency-Key': message.idempotencyKey }
          : undefined,
      });

      if (timedOut) return unknownTimeoutResult(this.name);
      this.logger.log(`Email sent via SMTP to ${message.to}: ${info.messageId}`);
      return { sent: true, provider: this.name, messageId: info.messageId };
    } catch (error: any) {
      if (
        timedOut
        || error?.code === 'ETIMEDOUT'
        || /timed?\s*out|greeting never received/i.test(String(error?.message))
      ) {
        return unknownTimeoutResult(this.name);
      }
      this.logger.error(`SMTP send failed to ${message.to}: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    } finally {
      clearTimeout(timeout);
      if (lateClose) clearImmediate(lateClose);
      // This runs only after sendMail has settled. Destroying again here makes
      // return from send() the ownership boundary for every per-send socket.
      this.closeOwnedTransport(transport);
    }
  }

  private closeOwnedTransport(transport: OwnedSmtpTransport): void {
    const resources = [...(transport.transporter?._connections ?? [])];
    const sockets = resources.map((resource) => {
      const wrappedSocket = resource.connection?._socket;
      return wrappedSocket?.socket ?? wrappedSocket;
    });

    // Marks the pool closed and fails any work that has not acquired a resource.
    transport.close?.();
    for (const resource of resources) resource.close?.();
    // SMTPConnection.close() is graceful after greeting. A hard deadline also
    // destroys the owned socket so an active half-open transaction cannot live.
    for (const socket of sockets) {
      if (!socket?.destroyed) socket?.destroy?.();
    }
  }
}
