import type { EmailSendOptions } from '../email-provider.interface';

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

/**
 * Aborts an HTTP transport at the deadline but does not return until fetch has
 * actually settled, so callers never make the delivery retry-eligible while
 * the original in-process request is still live.
 */
export async function boundedEmailFetch<T>(
  input: string,
  init: RequestInit,
  options: EmailSendOptions | undefined,
  consume: (response: Response) => Promise<T> | T,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, emailSendTimeoutMs(options));
  timeout.unref?.();
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const result = await consume(response);
    if (timedOut) throw new EmailTransportTimeoutError();
    return result;
  } catch (error: unknown) {
    if (timedOut) throw new EmailTransportTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function unknownTimeoutResult(provider: string): {
  sent: false;
  provider: string;
  error: string;
  outcomeUnknown: true;
} {
  return {
    sent: false,
    provider,
    error: 'Email transport timed out',
    outcomeUnknown: true,
  };
}
