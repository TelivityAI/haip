import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ChannelReservation,
} from '../../channel-adapter.interface';

export function mapAvailabilityToChannex(
  propertyId: string,
  items: AvailabilityPushParams['items'],
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    property_id: propertyId,
    room_type_id: item.channelRoomCode,
    date: item.date,
    availability: item.available,
  }));
}

export function mapRatesToChannex(
  propertyId: string,
  items: RatePushParams['items'],
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    property_id: propertyId,
    rate_plan_id: item.channelRateCode,
    date: item.date,
    rate: item.amount,
    currency: item.currencyCode,
  }));
}

export function mapRestrictionsToChannex(
  propertyId: string,
  items: RestrictionPushParams['items'],
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    property_id: propertyId,
    rate_plan_id: item.channelRateCode,
    date: item.date,
    stop_sell: item.stopSell,
    closed_to_arrival: item.closedToArrival,
    closed_to_departure: item.closedToDeparture,
    min_stay_arrival: item.minLos,
    max_stay: item.maxLos,
  }));
}

/** Map Channex booking revision feed entries → HAIP reservations (stub shape). */
export function mapChannexRevisionToHaip(
  revision: Record<string, unknown>,
  propertyId: string,
): ChannelReservation | null {
  const attributes = (revision['attributes'] ?? revision) as Record<string, unknown>;
  const booking = (attributes['booking'] ?? attributes) as Record<string, unknown>;
  const customer = (booking['customer'] ?? {}) as Record<string, unknown>;
  const rooms = (booking['rooms'] ?? []) as Array<Record<string, unknown>>;
  const room = rooms[0] ?? {};

  const externalConfirmation = String(
    booking['id'] ?? revision['id'] ?? attributes['id'] ?? '',
  );
  if (!externalConfirmation) return null;

  const statusRaw = String(attributes['status'] ?? booking['status'] ?? 'new').toLowerCase();
  const status: ChannelReservation['status'] =
    statusRaw === 'cancelled' ? 'cancelled' : statusRaw === 'modified' ? 'modified' : 'new';

  const arrivalDate = String(booking['arrival_date'] ?? room['checkin_date'] ?? '');
  const departureDate = String(booking['departure_date'] ?? room['checkout_date'] ?? '');

  return {
    externalConfirmation,
    channelCode: 'channex',
    channelHotelId: String(booking['property_id'] ?? propertyId),
    guestFirstName: String(customer['name'] ?? customer['first_name'] ?? 'Guest'),
    guestLastName: String(customer['surname'] ?? customer['last_name'] ?? ''),
    guestEmail: customer['mail'] != null ? String(customer['mail']) : undefined,
    guestPhone: customer['phone'] != null ? String(customer['phone']) : undefined,
    channelRoomCode: String(room['room_type_id'] ?? room['room_type'] ?? ''),
    channelRateCode: String(room['rate_plan_id'] ?? room['rate_plan'] ?? ''),
    arrivalDate,
    departureDate,
    adults: Number(
      (room['occupancy'] as Record<string, unknown> | undefined)?.['adults'] ??
        (booking['occupancy'] as Record<string, unknown> | undefined)?.['adults'] ??
        1,
    ),
    children: Number(
      (room['occupancy'] as Record<string, unknown> | undefined)?.['children'] ??
        (booking['occupancy'] as Record<string, unknown> | undefined)?.['children'] ??
        0,
    ),
    totalAmount: Number(booking['amount'] ?? booking['total_price'] ?? 0),
    currencyCode: String(booking['currency'] ?? 'USD'),
    status,
    channelBookingDate: new Date(String(attributes['inserted_at'] ?? Date.now())),
    rawPayload: revision,
  };
}
