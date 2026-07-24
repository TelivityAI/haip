/**
 * Direct booking deep-link contract for metasearch / marketing partners.
 *
 * HAIP's booking engine is the destination; partners pass stay params and the
 * property booking key. No inventory hold is created by the link itself.
 */

export interface BookingDeepLinkParams {
  /** Absolute origin of the booking UI, e.g. https://book.example.com */
  bookingAppOrigin: string;
  propertyId: string;
  /** Public booking engine key (Settings → Booking Engine). */
  bookingKey: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  roomTypeId?: string;
  ratePlanId?: string;
  /** Partner click / campaign id for conversion attribution. */
  clickId?: string;
}

/** Build a guest-facing search/book URL for the HAIP booking app. */
export function buildBookingDeepLink(params: BookingDeepLinkParams): string {
  const origin = params.bookingAppOrigin.replace(/\/$/, '');
  const qs = new URLSearchParams();
  qs.set('propertyId', params.propertyId);
  qs.set('key', params.bookingKey);
  if (params.checkIn) qs.set('checkIn', params.checkIn);
  if (params.checkOut) qs.set('checkOut', params.checkOut);
  if (params.adults != null) qs.set('adults', String(params.adults));
  if (params.children != null) qs.set('children', String(params.children));
  if (params.roomTypeId) qs.set('roomTypeId', params.roomTypeId);
  if (params.ratePlanId) qs.set('ratePlanId', params.ratePlanId);
  if (params.clickId) qs.set('clickId', params.clickId);
  return `${origin}/?${qs.toString()}`;
}
