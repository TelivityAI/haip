import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ChannelReservation,
} from '../../channel-adapter.interface';

function nextIsoDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Collapse consecutive same-valued day rows into Channex date_from/date_to ranges.
 * Certification expects batched range updates (not one API field per calendar day
 * when values are identical across a contiguous window).
 */
export function collapseDateRanges<T extends { date: string }>(
  items: T[],
  sameValue: (a: T, b: T) => boolean,
): Array<Omit<T, 'date'> & { date?: string; date_from?: string; date_to?: string }> {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const out: Array<Omit<T, 'date'> & { date?: string; date_from?: string; date_to?: string }> = [];

  let start = sorted[0]!;
  let end = sorted[0]!;

  const flush = () => {
    const { date: _date, ...rest } = start;
    if (start.date === end.date) {
      out.push({ ...rest, date: start.date });
    } else {
      out.push({ ...rest, date_from: start.date, date_to: end.date });
    }
  };

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (sameValue(end, cur) && cur.date === nextIsoDate(end.date)) {
      end = cur;
      continue;
    }
    flush();
    start = cur;
    end = cur;
  }
  flush();
  return out;
}

export function mapAvailabilityToChannex(
  propertyId: string,
  items: AvailabilityPushParams['items'],
): Array<Record<string, unknown>> {
  const collapsed = collapseDateRanges(items, (a, b) => a.available === b.available && a.channelRoomCode === b.channelRoomCode);

  return collapsed.map((item) => {
    const base: Record<string, unknown> = {
      property_id: propertyId,
      room_type_id: item.channelRoomCode,
      availability: item.available,
    };
    if (item.date_from && item.date_to) {
      base['date_from'] = item.date_from;
      base['date_to'] = item.date_to;
    } else {
      base['date'] = item.date;
    }
    return base;
  });
}

export function mapRatesToChannex(
  propertyId: string,
  items: RatePushParams['items'],
): Array<Record<string, unknown>> {
  const collapsed = collapseDateRanges(
    items,
    (a, b) =>
      a.channelRateCode === b.channelRateCode &&
      a.amount === b.amount &&
      a.currencyCode === b.currencyCode,
  );

  return collapsed.map((item) => {
    const base: Record<string, unknown> = {
      property_id: propertyId,
      rate_plan_id: item.channelRateCode,
      // Decimal string avoids floating-point drift; Channex accepts "200.00" or minor units.
      rate: Number(item.amount).toFixed(2),
    };
    if (item.date_from && item.date_to) {
      base['date_from'] = item.date_from;
      base['date_to'] = item.date_to;
    } else {
      base['date'] = item.date;
    }
    return base;
  });
}

export function mapRestrictionsToChannex(
  propertyId: string,
  items: RestrictionPushParams['items'],
): Array<Record<string, unknown>> {
  const collapsed = collapseDateRanges(
    items,
    (a, b) =>
      a.channelRateCode === b.channelRateCode &&
      a.stopSell === b.stopSell &&
      a.closedToArrival === b.closedToArrival &&
      a.closedToDeparture === b.closedToDeparture &&
      a.minLos === b.minLos &&
      a.maxLos === b.maxLos,
  );

  return collapsed.map((item) => {
    const base: Record<string, unknown> = {
      property_id: propertyId,
      rate_plan_id: item.channelRateCode,
      stop_sell: item.stopSell,
      closed_to_arrival: item.closedToArrival,
      closed_to_departure: item.closedToDeparture,
    };
    // HAIP models a single min LOS; map to Channex min_stay_arrival (cert Extra Notes).
    if (item.minLos != null) base['min_stay_arrival'] = item.minLos;
    if (item.maxLos != null && item.maxLos > 0) base['max_stay'] = item.maxLos;

    if (item.date_from && item.date_to) {
      base['date_from'] = item.date_from;
      base['date_to'] = item.date_to;
    } else {
      base['date'] = item.date;
    }
    return base;
  });
}

/** Map Channex booking revision feed / webhook entries → HAIP reservations. */
export function mapChannexRevisionToHaip(
  revision: Record<string, unknown>,
  propertyId: string,
): ChannelReservation | null {
  const attributes = (revision['attributes'] ?? revision) as Record<string, unknown>;
  const booking = (attributes['booking'] ?? attributes) as Record<string, unknown>;
  const customer = (booking['customer'] ?? {}) as Record<string, unknown>;
  const rooms = (booking['rooms'] ?? []) as Array<Record<string, unknown>>;
  const room = rooms[0] ?? {};

  const revisionId = String(revision['id'] ?? attributes['id'] ?? '');
  const bookingId = String(booking['id'] ?? '');
  // Stable booking id for PMS dedup; fall back to revision when booking payload is sparse.
  const externalConfirmation = bookingId || revisionId;
  if (!externalConfirmation) return null;

  const statusRaw = String(attributes['status'] ?? booking['status'] ?? 'new').toLowerCase();
  const status: ChannelReservation['status'] =
    statusRaw === 'cancelled' ? 'cancelled' : statusRaw === 'modified' ? 'modified' : 'new';

  const arrivalDate = String(booking['arrival_date'] ?? room['checkin_date'] ?? '');
  const departureDate = String(booking['departure_date'] ?? room['checkout_date'] ?? '');

  return {
    externalConfirmation,
    externalRevisionId: revisionId || undefined,
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

/** Extract Channex task ids from a successful ARI response body. */
export function extractChannexTaskIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const rows = (data as { data?: unknown }).data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const id = (row as { id?: unknown }).id;
      return typeof id === 'string' && id.length > 0 ? id : null;
    })
    .filter((id): id is string => id != null);
}
