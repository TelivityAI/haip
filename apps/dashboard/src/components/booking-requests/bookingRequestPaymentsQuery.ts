import { api } from '../../lib/api';
import type { BookingRequestPaymentsResponse } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isPaymentsResponse(value: unknown): value is BookingRequestPaymentsResponse {
  return isRecord(value)
    && Array.isArray(value.movements)
    && Array.isArray(value.allocations)
    && Array.isArray(value.resolutions);
}

export async function fetchBookingRequestPayments(
  requestId: string,
  propertyId: string,
): Promise<BookingRequestPaymentsResponse> {
  const response = await api.get(`/v1/booking-requests/${requestId}/payments`, {
    params: { propertyId },
  });
  const payload = isRecord(response.data) && 'data' in response.data
    ? response.data.data
    : response.data;
  if (!isPaymentsResponse(payload)) {
    throw new Error('Booking request payment response is incomplete');
  }
  return payload;
}
