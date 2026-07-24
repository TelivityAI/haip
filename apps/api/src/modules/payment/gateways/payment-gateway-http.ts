export interface GatewayHttpJsonResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data?: T;
  errorMessage?: string;
}

export type GatewayFetchFn = typeof fetch;

export async function gatewayJsonRequest<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { idempotencyKey?: string },
  fetchFn: GatewayFetchFn = fetch,
): Promise<GatewayHttpJsonResult<T>> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.idempotencyKey) {
    headers.set('Idempotency-Key', init.idempotencyKey);
  }

  try {
    const response = await fetchFn(url, { ...init, headers });
    const text = await response.text();
    let data: T | undefined;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = undefined;
      }
    }

    if (!response.ok) {
      const message =
        (data as { message?: string } | undefined)?.message ??
        (data as { errorMessage?: string } | undefined)?.errorMessage ??
        (data as { detail?: string } | undefined)?.detail ??
        (text || `HTTP ${response.status}`);
      return { ok: false, status: response.status, data, errorMessage: message };
    }

    return { ok: true, status: response.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gateway request failed';
    return { ok: false, status: 0, errorMessage: message };
  }
}

/** Convert major currency units (e.g. 10.50 USD) to minor units (cents). */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Format amount for Braintree (decimal string in major units). */
export function toMajorAmountString(amount: number): string {
  return amount.toFixed(2);
}
