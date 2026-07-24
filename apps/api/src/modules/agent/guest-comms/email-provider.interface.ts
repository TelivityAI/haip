export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
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
