/** Mirrors server HAIP_BOOKING_REQUESTS for booking widget UI gating. */
export function isBookingRequestsUiEnabled(): boolean {
  return import.meta.env.VITE_HAIP_BOOKING_REQUESTS === 'true';
}
