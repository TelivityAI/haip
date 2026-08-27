export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  /**
   * Correlation key forwarded to providers as custom metadata
   * (e.g. Mailgun `v:haip-idempotency-key`, SendGrid custom_args). Useful for
   * log/trace correlation across retries — NOT an exactly-once or deduplication
   * guarantee in Mailgun, SendGrid, SES, or SMTP.
   */
  idempotencyKey?: string;
  /**
   * Stable RFC Message-ID reused across retries for correlation when the
   * provider supports setting it. Does not prevent duplicate delivery.
   */
  messageId?: string;
}

/** Provider-confirmed acceptance vs definite failure vs ambiguous response. */
export type EmailDeliveryStatus = 'sent' | 'notSent' | 'outcomeUnknown';

export interface EmailResult {
  /** `sent` = provider confirmed; `notSent` = safe to auto-retry; `outcomeUnknown` = do not auto-retry. */
  status: EmailDeliveryStatus;
  /** Convenience mirror of `status === 'sent'`. */
  sent: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

export interface EmailSendOptions {
  /**
   * Hard send deadline in milliseconds. HTTP transports return at the deadline
   * even when the underlying fetch ignores abort; SMTP hard-closes owned sockets
   * and returns via `Promise.race` even if `sendMail` is still settling.
   */
  timeoutMs?: number;
  /**
   * Max send attempts for definitely-not-sent failures (`status: 'notSent'`).
   * Does not retry `outcomeUnknown` (ambiguous acceptance).
   */
  maxAttempts?: number;
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailResult>;
}

export const EMAIL_PROVIDERS = Symbol('EMAIL_PROVIDERS');
