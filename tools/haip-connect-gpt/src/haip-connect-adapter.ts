/**
 * HaipConnectAdapter — the equivalent of OTAIP/Ligare's duffel-connect-adapter,
 * but the "domain engine" here is HAIP's already-built Connect API. Each method is
 * a single typed HTTP call to `${baseUrl}/api/v1/connect/*`, with the gateway's
 * `x-api-key` injected server-side (the GPT never sees it).
 *
 * Every response is passed through stripNetRate() before it leaves the adapter, so
 * no net/wholesale/cost field can ever reach the caller (selling price only).
 */

import { stripNetRate } from './scrub.js';

export interface AdapterConfig {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout in ms. Defaults to 20s. */
  timeoutMs?: number;
}

/** Thrown for any non-2xx upstream response (or transport failure). */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HAIP Connect API responded ${status}`);
    this.name = 'UpstreamError';
  }
}

// --- Request shapes (mirror HAIP's Connect DTOs; no invented fields) ---

export interface SearchInput {
  city?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  propertyId?: string;
  checkIn: string;
  checkOut: string;
  rooms?: number;
  adults?: number;
  children?: number;
  rateType?: string;
  amenities?: string[];
  accessibleOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface BookInput {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail?: string;
  guestPhone?: string;
  loyaltyNumber?: string;
  adults: number;
  children?: number;
  specialRequests?: string;
  paymentMethod?: 'pay_at_property' | 'prepaid' | 'virtual_card';
  paymentToken?: string;
}

export interface ModifyInput {
  guestFirstName?: string;
  guestLastName?: string;
  specialRequests?: string;
  adults?: number;
  children?: number;
  checkIn?: string;
  checkOut?: string;
  roomTypeId?: string;
  ratePlanId?: string;
}

export class HaipConnectAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new UpstreamError(502, {
        error: 'upstream_unreachable',
        message: (err as Error).message,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const payload: unknown = text ? safeJson(text) : null;

    if (!res.ok) {
      throw new UpstreamError(res.status, payload);
    }
    return stripNetRate(payload);
  }

  searchHotels(input: SearchInput): Promise<unknown> {
    return this.call('POST', '/api/v1/connect/search', input);
  }

  getProperty(propertyId: string): Promise<unknown> {
    return this.call('GET', `/api/v1/connect/properties/${encodeURIComponent(propertyId)}`);
  }

  createReservation(input: BookInput): Promise<unknown> {
    return this.call('POST', '/api/v1/connect/book', input);
  }

  getReservation(confirmationNumber: string): Promise<unknown> {
    return this.call(
      'GET',
      `/api/v1/connect/bookings/${encodeURIComponent(confirmationNumber)}/verify`,
    );
  }

  modifyReservation(confirmationNumber: string, changes: ModifyInput): Promise<unknown> {
    return this.call(
      'PATCH',
      `/api/v1/connect/bookings/${encodeURIComponent(confirmationNumber)}`,
      changes,
    );
  }

  cancelReservation(confirmationNumber: string, reason?: string): Promise<unknown> {
    return this.call(
      'DELETE',
      `/api/v1/connect/bookings/${encodeURIComponent(confirmationNumber)}`,
      { reason },
    );
  }

  /** Liveness probe against the upstream HAIP API. */
  async upstreamHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
