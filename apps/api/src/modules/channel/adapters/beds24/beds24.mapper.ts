import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ChannelReservation,
} from '../../channel-adapter.interface';

function toBeds24Date(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

function formatModifiedSince(since?: Date): string | undefined {
  if (!since) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${since.getFullYear()}${pad(since.getMonth() + 1)}${pad(since.getDate())} ${pad(since.getHours())}:${pad(since.getMinutes())}:${pad(since.getSeconds())}`;
}

/** Group HAIP availability by Beds24 roomId → dates map for setRoomDates. */
export function mapAvailabilityToBeds24RoomDates(
  items: AvailabilityPushParams['items'],
): Map<string, Record<string, Record<string, string>>> {
  const byRoom = new Map<string, Record<string, Record<string, string>>>();
  for (const item of items) {
    let dates = byRoom.get(item.channelRoomCode);
    if (!dates) {
      dates = {};
      byRoom.set(item.channelRoomCode, dates);
    }
    const key = toBeds24Date(item.date);
    dates[key] = { ...(dates[key] ?? {}), i: String(item.available) };
  }
  return byRoom;
}

export function mapRatesToBeds24RoomDates(
  items: RatePushParams['items'],
): Map<string, Record<string, Record<string, string>>> {
  const byRoom = new Map<string, Record<string, Record<string, string>>>();
  for (const item of items) {
    let dates = byRoom.get(item.channelRoomCode);
    if (!dates) {
      dates = {};
      byRoom.set(item.channelRoomCode, dates);
    }
    const key = toBeds24Date(item.date);
    dates[key] = {
      ...(dates[key] ?? {}),
      p1: item.amount.toFixed(2),
    };
  }
  return byRoom;
}

export function mapRestrictionsToBeds24RoomDates(
  items: RestrictionPushParams['items'],
): Map<string, Record<string, Record<string, string>>> {
  const byRoom = new Map<string, Record<string, Record<string, string>>>();
  for (const item of items) {
    let dates = byRoom.get(item.channelRoomCode);
    if (!dates) {
      dates = {};
      byRoom.set(item.channelRoomCode, dates);
    }
    const key = toBeds24Date(item.date);
    const patch: Record<string, string> = { ...(dates[key] ?? {}) };
    if (item.minLos != null) patch['m'] = String(item.minLos);
    if (item.maxLos != null) patch['mx'] = String(item.maxLos);
    if (item.stopSell) patch['i'] = '0';
    if (item.closedToArrival) patch['o'] = '1';
    dates[key] = patch;
  }
  return byRoom;
}

export function buildGetBookingsBody(
  auth: { apiKey: string; propKey: string },
  since?: Date,
): Record<string, unknown> {
  const body: Record<string, unknown> = { authentication: auth };
  const modifiedSince = formatModifiedSince(since);
  if (modifiedSince) body['modifiedSince'] = modifiedSince;
  body['limit'] = '100';
  return body;
}

export function mapBeds24BookingToHaip(
  booking: Record<string, unknown>,
  propKey: string,
): ChannelReservation | null {
  const bookId = String(booking['bookId'] ?? booking['id'] ?? '');
  if (!bookId) return null;

  const statusCode = String(booking['status'] ?? '1');
  const status: ChannelReservation['status'] =
    statusCode === '0' ? 'cancelled' : statusCode === '2' ? 'modified' : 'new';

  const arrivalRaw = String(booking['firstNight'] ?? booking['arrival'] ?? '');
  const departureRaw = String(booking['lastNight'] ?? booking['departure'] ?? '');

  const toIso = (yyyymmdd: string) =>
    yyyymmdd.length === 8
      ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
      : yyyymmdd;

  return {
    externalConfirmation: bookId,
    channelCode: 'beds24',
    channelHotelId: propKey,
    guestFirstName: String(booking['guestFirstName'] ?? booking['guestName'] ?? 'Guest'),
    guestLastName: String(booking['guestName'] ?? booking['guestLastName'] ?? ''),
    guestEmail: booking['guestEmail'] != null ? String(booking['guestEmail']) : undefined,
    guestPhone: booking['guestPhone'] != null ? String(booking['guestPhone']) : undefined,
    channelRoomCode: String(booking['roomId'] ?? ''),
    channelRateCode: String(booking['rateId'] ?? booking['price'] ?? ''),
    arrivalDate: toIso(arrivalRaw),
    departureDate: toIso(departureRaw),
    adults: Number(booking['numAdult'] ?? 1),
    children: Number(booking['numChild'] ?? 0),
    totalAmount: Number(booking['price'] ?? booking['deposit'] ?? 0),
    currencyCode: String(booking['currency'] ?? 'USD'),
    status,
    channelBookingDate: new Date(String(booking['bookingTime'] ?? Date.now())),
    rawPayload: booking,
  };
}
