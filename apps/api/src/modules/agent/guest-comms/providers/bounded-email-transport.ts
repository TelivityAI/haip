import type { EmailResult, EmailSendOptions } from '../email-provider.interface';

export const DEFAULT_EMAIL_SEND_TIMEOUT_MS = 60_000;

export class EmailTransportTimeoutError extends Error {
  constructor() {
    super('Email transport timed out');
    this.name = 'EmailTransportTimeoutError';
  }
}

export function emailSendTimeoutMs(options?: EmailSendOptions): number {
  const requested = options?.timeoutMs;
  if (!Number.isFinite(requested) || requested === undefined) {
    return DEFAULT_EMAIL_SEND_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(requested));
}

export function sentEmailResult(
  provider: string,
  messageId?: string,
): EmailResult {
  return { status: 'sent', sent: true, provider, messageId };
}

export function notSentEmailResult(
  provider: string,
  error?: string,
): EmailResult {
  return { status: 'notSent', sent: false, provider, error };
}

export function unknownTimeoutResult(provider: string): EmailResult {
  return {
    status: 'outcomeUnknown',
    sent: false,
    provider,
    error: 'Email transport timed out',
  };
}

/**
 * Hard outer deadline for HTTP email sends, including response-body consumption.
 * Returns at `timeoutMs` even when fetch/abort is ignored; in-flight work
 * continues detached with a rejection handler so callers never see an
 * unhandled rejection.
 */
export async function boundedEmailFetch<T>(
  input: string,
  init: RequestInit,
  options: EmailSendOptions | undefined,
  consume: (response: Response) => Promise<T> | T,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = emailSendTimeoutMs(options);

  const work = (async (): Promise<T> => {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await consume(response);
  })();

  work.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EmailTransportTimeoutError());
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
