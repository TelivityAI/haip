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
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<EmailResult>;
}

export const EMAIL_PROVIDERS = Symbol('EMAIL_PROVIDERS');
