import { assertSafeChannelEndpoint } from '../../../common/security/url-guard';

export interface ChannelHttpJsonResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data?: T;
  errorMessage?: string;
}

export type ChannelFetchFn = typeof fetch;

export async function channelJsonRequest<T = Record<string, unknown>>(
  url: string,
  init: RequestInit,
  fetchFn: ChannelFetchFn = fetch,
): Promise<ChannelHttpJsonResult<T>> {
  await assertSafeChannelEndpoint(url);

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetchFn(url, { ...init, headers, redirect: 'manual' });
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
        (data as { error?: string } | undefined)?.error ??
        (data as { errors?: { title?: string } } | undefined)?.errors?.title ??
        (text || `HTTP ${response.status}`);
      return { ok: false, status: response.status, data, errorMessage: message };
    }

    return { ok: true, status: response.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Channel request failed';
    return { ok: false, status: 0, errorMessage: message };
  }
}
