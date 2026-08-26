/** True when the optional booking-requests module should load. */
export function isBookingRequestsEnabled(): boolean {
  return process.env['HAIP_BOOKING_REQUESTS'] === 'true';
}
