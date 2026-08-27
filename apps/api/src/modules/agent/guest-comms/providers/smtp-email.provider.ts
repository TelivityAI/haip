import { Injectable, Logger } from '@nestjs/common';
import type {
  EmailMessage,
  EmailProvider,
  EmailResult,
  EmailSendOptions,
} from '../email-provider.interface';
import {
  emailSendTimeoutMs,
  notSentEmailResult,
  sentEmailResult,
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
      return notSentEmailResult(this.name, 'SMTP not configured');
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
    const from = message.from ?? process.env['SMTP_FROM'] ?? 'noreply@haip.dev';
    const mailPayload = {
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      messageId: message.messageId,
      headers: message.idempotencyKey
        ? { 'X-HAIP-Idempotency-Key': message.idempotencyKey }
        : undefined,
    };

    const sendMailPromise = transport.sendMail(mailPayload).then(
      (info) => {
        if (timedOut) return unknownTimeoutResult(this.name);
        this.logger.log(`Email sent via SMTP to ${message.to}: ${info.messageId}`);
        return sentEmailResult(this.name, info.messageId);
      },
      (error: any) => {
        if (
          timedOut
          || error?.code === 'ETIMEDOUT'
          || /timed?\s*out|greeting never received/i.test(String(error?.message))
        ) {
          return unknownTimeoutResult(this.name);
        }
        this.logger.error(`SMTP send failed to ${message.to}: ${error.message}`);
        return notSentEmailResult(this.name, error.message);
      },
    );

    sendMailPromise.finally(() => {
      this.closeOwnedTransport(transport);
    });

    const deadlinePromise = new Promise<EmailResult>((resolve) => {
      const timeout = setTimeout(() => {
        timedOut = true;
        this.closeOwnedTransport(transport);
        const lateClose = setImmediate(() => this.closeOwnedTransport(transport));
        lateClose.unref?.();
        resolve(unknownTimeoutResult(this.name));
      }, timeoutMs);
      timeout.unref?.();
      sendMailPromise.finally(() => clearTimeout(timeout));
    });

    return await Promise.race([sendMailPromise, deadlinePromise]);
  }

  /**
   * Hard-close helper for per-send Nodemailer pools. Uses Nodemailer-internal
   * pool/socket fields (`_connections`, `_socket`) — version-sensitive; covered
   * by smtp-email.provider.spec integration tests.
   */
  private closeOwnedTransport(transport: OwnedSmtpTransport): void {
    const resources = [...(transport.transporter?._connections ?? [])];
    const sockets = resources.map((resource) => {
      const wrappedSocket = resource.connection?._socket;
      return wrappedSocket?.socket ?? wrappedSocket;
    });

    transport.close?.();
    for (const resource of resources) resource.close?.();
    for (const socket of sockets) {
      if (!socket?.destroyed) socket?.destroy?.();
    }
  }
}
