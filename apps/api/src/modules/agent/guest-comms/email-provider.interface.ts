export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  /**
   * Stable caller identity forwarded to providers that support deduplication
   * (e.g. Mailgun `v:haip-idempotency-key`). Safe to retry when the transport
   * returns `outcomeUnknown` after a cooperative deadline.
   */
  idempotencyKey?: string;
  /**
   * Stable RFC Message-ID reused across retries so duplicate deliveries share
   * the same provider-visible message identity when supported.
   */
  messageId?: string;
}

export interface EmailResult {
  sent: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  /** True when the transport may have accepted mail before timing out. */
  outcomeUnknown?: boolean;
}

export interface EmailSendOptions {
  /**
   * Cooperative send deadline in milliseconds. HTTP transports abort at the
   * deadline but await settlement before returning `outcomeUnknown`; SMTP
   * closes owned sockets and returns at the deadline even if `sendMail` is
   * still settling.
   */
  timeoutMs?: number;
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailResult>;
}

export const EMAIL_PROVIDERS = Symbol('EMAIL_PROVIDERS');
