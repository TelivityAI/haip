import type { ChannelReservation } from '../../channel-adapter.interface';

/**
 * Map an Expedia Booking Notification payload → HAIP ChannelReservation[].
 *
 * Expedia delivers new bookings/modifications/cancellations by PUSH (Booking
 * Notification API), not polling. The legacy Booking Retrieval/Confirmation EQC
 * APIs are closed to new partners. Exact element paths are modeled to the EQC
 * booking schema and marked VERIFY — confirm against the Booking Notification
 * reference. Source: developers.expediagroup.com/supply/lodging/docs/booking_apis.
 */
export function mapExpediaBookingToHaip(data: Record<string, unknown>): ChannelReservation[] {
  const bookings = extractArray(data, 'Bookings', 'Booking').length
    ? extractArray(data, 'Bookings', 'Booking')
    : data['Booking']
      ? [data['Booking']]
      : [];

  return bookings.map((b: any) => {
    const type = String(b['@_type'] ?? b['@_status'] ?? 'Book').toLowerCase();
    let status: ChannelReservation['status'] = 'new';
    if (type.includes('cancel')) status = 'cancelled';
    else if (type.includes('modif')) status = 'modified';

    const roomStay = b.RoomStay ?? b.RoomStays?.RoomStay ?? {};
    const guest = b.PrimaryGuest ?? roomStay.Guest ?? {};
    const name = guest.Name ?? guest;
    const stay = roomStay.StayDate ?? roomStay ?? {};
    const total = roomStay.Total ?? b.Total ?? {};

    return {
      externalConfirmation: String(b['@_id'] ?? b['@_confirmId'] ?? b.UniqueID?.['@_id'] ?? `EXP-${Date.now()}`),
      channelCode: 'expedia',
      guestFirstName: String(name.GivenName ?? name['@_givenName'] ?? 'Guest'),
      guestLastName: String(name.Surname ?? name['@_surname'] ?? 'Unknown'),
      guestEmail: guest.Email ? String(guest.Email) : undefined,
      guestPhone: guest.Phone ? String(guest.Phone) : undefined,
      channelRoomCode: String(roomStay['@_roomTypeID'] ?? roomStay.RoomType?.['@_id'] ?? 'UNKNOWN'),
      channelRateCode: String(roomStay['@_ratePlanID'] ?? roomStay.RatePlan?.['@_id'] ?? 'UNKNOWN'),
      arrivalDate: String(stay['@_arrival'] ?? stay['@_from'] ?? ''),
      departureDate: String(stay['@_departure'] ?? stay['@_to'] ?? ''),
      adults: Number(roomStay['@_adultCount'] ?? roomStay.GuestCount?.['@_adult'] ?? 2),
      children: Number(roomStay['@_childCount'] ?? roomStay.GuestCount?.['@_child'] ?? 0),
      totalAmount: parseFloat(total['@_amount'] ?? total['@_amountAfterTaxes'] ?? '0'),
      currencyCode: String(total['@_currency'] ?? 'USD'),
      status,
      channelBookingDate: b['@_createDateTime'] ? new Date(b['@_createDateTime']) : new Date(),
      rawPayload: b as Record<string, unknown>,
    };
  });
}

/** Booking Confirmation (EQC BC) body — return the PMS confirmation to Expedia. */
export function buildBookingConfirmation(
  username: string,
  password: string,
  items: Array<{ externalConfirmation: string; pmsConfirmation: string }>,
): Record<string, unknown> {
  return {
    Authentication: { '@_username': username, '@_password': password },
    Booking: items.map((i) => ({
      '@_id': i.externalConfirmation,
      '@_confirmNumber': i.pmsConfirmation,
    })),
  };
}

function extractArray(data: Record<string, unknown>, containerKey: string, itemKey: string): unknown[] {
  const container = (data as any)[containerKey];
  if (!container) return [];
  const items = container[itemKey];
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}
