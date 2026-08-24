export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  /** Stable caller identity for providers/gateways that support deduplication. */
  idempotencyKey?: string;
  /** Stable RFC Message-ID reused when an at-least-once transport is retried. */
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
  /** Hard upper bound requested by the caller for transport settlement. */
  timeoutMs?: number;
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailResult>;
}

export const EMAIL_PROVIDERS = Symbol('EMAIL_PROVIDERS');
