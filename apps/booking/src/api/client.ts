import axios from 'axios';
import { resolveBookingKey } from '../lib/bookingKey';
import type {
  BookRequest,
  BookResponse,
  BookingConfig,
  BookingDetails,
  CancelResponse,
  QuoteRequest,
  QuoteResponse,
  SearchRequest,
  SearchResponse,
  SellableServicesResponse,
} from './types';

/**
 * Tiny API client for the public booking engine. Authenticates ONLY with the
 * publishable booking key (`x-booking-key`). No propertyId is ever sent — the
 * server derives it from the key.
 *
 * baseURL is `/api/v1/booking-engine` (same-origin demo). `VITE_API_BASE`
 * overrides the origin for cross-origin embeds.
 */

let bookingKey = '';

export function setBookingKey(key: string) {
  bookingKey = key;
  api.defaults.headers.common['x-booking-key'] = key;
}

export function getBookingKey(): string {
  return bookingKey;
}

const origin = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const api = axios.create({
  baseURL: `${origin}/api/v1/booking-engine`,
  headers: { 'Content-Type': 'application/json' },
});

// Initialise the key eagerly so the first request is authenticated.
setBookingKey(resolveBookingKey());

export const bookingApi = {
  config: async (): Promise<BookingConfig> => {
    const { data } = await api.get<BookingConfig>('/config');
    return data;
  },

  search: async (body: SearchRequest): Promise<SearchResponse> => {
    const { data } = await api.post<SearchResponse>('/search', body);
    return data;
  },

  quote: async (body: QuoteRequest): Promise<QuoteResponse> => {
    const { data } = await api.post<QuoteResponse>('/quote', body);
    return data;
  },

  listServices: async (): Promise<SellableServicesResponse> => {
    const { data } = await api.get<SellableServicesResponse>('/services');
    return data;
  },

  book: async (body: BookRequest): Promise<BookResponse> => {
    const { data } = await api.post<BookResponse>('/book', body);
    return data;
  },

  getBooking: async (confirmationNumber: string): Promise<BookingDetails> => {
    const { data } = await api.get<BookingDetails>(
      `/bookings/${encodeURIComponent(confirmationNumber)}`,
    );
    return data;
  },

  cancelBooking: async (
    confirmationNumber: string,
    reason?: string,
  ): Promise<CancelResponse> => {
    const { data } = await api.delete<CancelResponse>(
      `/bookings/${encodeURIComponent(confirmationNumber)}`,
      { data: { reason } },
    );
    return data;
  },
};

/** Extract a human-readable message from an axios/booking-engine error. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    const msg = data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
