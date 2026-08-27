/** True when the optional `@telivityhaip/booking-requests` module should load. */
export function isBookingRequestsEnabled(): boolean {
  return process.env['HAIP_BOOKING_REQUESTS'] === 'true';
}
