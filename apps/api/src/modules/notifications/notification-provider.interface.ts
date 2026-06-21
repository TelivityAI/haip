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
