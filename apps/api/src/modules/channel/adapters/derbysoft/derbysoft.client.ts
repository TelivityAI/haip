import { Logger } from '@nestjs/common';
import { assertSafeChannelEndpoint } from '../../../../common/security/url-guard';
import {
  DERBYSOFT_RATE_LIMIT_PER_SEC,
  type DerbySoftConfig,
} from './derbysoft.config';

interface TokenCache {
  accessToken: string;
  /** Epoch ms when we should refresh (tokens last up to 90d; refresh early). */
  expiresAtMs: number;
}

/**
 * HTTP client for DerbySoft Property Connector with:
 * - OAuth Bearer token (client credentials via Basic → /account/token)
 * - 15 req/s token-bucket rate limiter
 * - SSRF guard + redirect:manual
 */
export class DerbySoftClient {
  private readonly logger = new Logger(DerbySoftClient.name);
  private tokenCache: TokenCache | null = null;
  private tokens = DERBYSOFT_RATE_LIMIT_PER_SEC;
  private lastRefill = Date.now();

  constructor(private readonly config: DerbySoftConfig) {}

  expandUrl(template: string): string {
    return template.replaceAll('{accountId}', encodeURIComponent(this.config.accountId));
  }

  private async acquireRateToken(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= 1000) {
      this.tokens = DERBYSOFT_RATE_LIMIT_PER_SEC;
      this.lastRefill = now;
    }
    if (this.tokens > 0) {
      this.tokens -= 1;
      return;
    }
    const waitMs = 1000 - (now - this.lastRefill) + 5;
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 5)));
    this.tokens = DERBYSOFT_RATE_LIMIT_PER_SEC - 1;
    this.lastRefill = Date.now();
  }

  async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAtMs) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = this.expandUrl(this.config.tokenUrl);
    await assertSafeChannelEndpoint(tokenUrl);

    const basic = Buffer.from(
      `${this.config.accountId}:${this.config.clientSecret}`,
      'utf8',
    ).toString('base64');

    await this.acquireRateToken();
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json;charset=utf-8',
        Accept: 'application/json',
      },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DerbySoft token request failed: HTTP ${res.status} ${text}`);
    }

    const json = (await res.json()) as { accessToken?: string; tokenType?: string };
    if (!json.accessToken) {
      throw new Error('DerbySoft token response missing accessToken');
    }

    // Refresh well before the vendor 90-day max (cache 12h for demos/tests).
    this.tokenCache = {
      accessToken: json.accessToken,
      expiresAtMs: Date.now() + 12 * 60 * 60 * 1000,
    };
    return json.accessToken;
  }

  /** Invalidate cached token (e.g. after 401). */
  clearToken(): void {
    this.tokenCache = null;
  }

  async postJson(
    url: string,
    body: Record<string, unknown>,
    opts?: { retryOnUnauthorized?: boolean },
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    await assertSafeChannelEndpoint(url);
    const maxRetries = this.config.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.acquireRateToken();
        const token = await this.getAccessToken();
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json;charset=utf-8',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
        });

        if (res.status === 401 && opts?.retryOnUnauthorized !== false) {
          this.clearToken();
          if (attempt < maxRetries) continue;
        }

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '1');
          await new Promise((r) => setTimeout(r, Math.max(retryAfter, 1) * 1000));
          continue;
        }

        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok || data['errorCode']) {
          return { ok: false, status: res.status, data };
        }
        return { ok: true, status: res.status, data };
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`DerbySoft POST ${url} attempt ${attempt + 1} failed: ${err?.message}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }
    }

    return {
      ok: false,
      status: 0,
      data: {
        errorCode: 'TransportError',
        errorMessage: lastError?.message ?? 'Unknown transport error',
      },
    };
  }
}
