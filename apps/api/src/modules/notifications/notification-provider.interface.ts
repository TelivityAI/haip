/**
 * SMS provider abstraction (KB-agnostic transport layer).
 *
 * The PMS ships the interface + a Twilio reference adapter + a console fallback.
 * Self-hosters supply their own credentials via env; no managed/hosted service.
 */
export interface SmsMessage {
  to: string;
  body: string;
  /** Optional override of the configured sender id/number. */
  from?: string;
}

export interface SmsResult {
  sent: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface SmsProvider {
  /** Stable identifier used in audit/webhook payloads. */
  readonly name: string;
  /** True only when the provider has all credentials it needs to actually send. */
  isConfigured(): boolean;
  send(message: SmsMessage): Promise<SmsResult>;
}

/** DI token so the service can resolve all registered SMS providers. */
export const SMS_PROVIDERS = Symbol('SMS_PROVIDERS');

export interface WhatsAppMessage {
  to: string;
  contentSid?: string;
  body?: string;
  variables?: Record<string, string>;
  /** Optional override of the configured sender id/number. */
  from?: string;
}

export interface WhatsAppResult {
  sent: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: WhatsAppMessage): Promise<WhatsAppResult>;
}

/** DI token so the service can resolve all registered WhatsApp providers. */
export const WHATSAPP_PROVIDERS = Symbol('WHATSAPP_PROVIDERS');

export interface TelegramMessage {
  /** Telegram chat id (numeric or @username for public chats). */
  to: string;
  body: string;
  /** Optional parse mode: HTML or MarkdownV2. */
  parseMode?: 'HTML' | 'MarkdownV2';
}

export interface TelegramResult {
  sent: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface TelegramProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: TelegramMessage): Promise<TelegramResult>;
}

/** All registered Telegram providers (factory input). */
export const TELEGRAM_PROVIDERS = Symbol('TELEGRAM_PROVIDERS');

/** Active Telegram adapter resolved from env via {@link NotificationProviderFactory}. */
export const TELEGRAM_PROVIDER = Symbol('TELEGRAM_PROVIDER');

/** Active SMS adapter resolved from env via {@link NotificationProviderFactory}. */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
