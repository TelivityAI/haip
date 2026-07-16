import { randomUUID } from 'node:crypto';
import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ChannelReservation,
  ContentPushParams,
} from '../../channel-adapter.interface';
import { DERBYSOFT_MESSAGE_VERSION } from './derbysoft.config';

export type AriUpdateType = 'Delta' | 'Overlay';

export interface DerbySoftHeader {
  echoToken: string;
  timeStamp: string;
  version: string;
}

export function buildHeader(echoToken?: string): DerbySoftHeader {
  return {
    echoToken: echoToken ?? randomUUID(),
    timeStamp: new Date().toISOString(),
    version: DERBYSOFT_MESSAGE_VERSION,
  };
}

/** Collapse consecutive same-value dates into [startDate, endDate] ranges. */
export function collapseDateRanges<T extends { date: string }>(
  items: T[],
  valueKey: (item: T) => string,
): Array<{ startDate: string; endDate: string; sample: T }> {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const ranges: Array<{ startDate: string; endDate: string; sample: T }> = [];
  let start = sorted[0]!;
  let end = sorted[0]!;
  let key = valueKey(start);

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const curKey = valueKey(cur);
    const prevDate = new Date(end.date + 'T00:00:00Z');
    prevDate.setUTCDate(prevDate.getUTCDate() + 1);
    const expectedNext = prevDate.toISOString().slice(0, 10);
    if (curKey === key && cur.date === expectedNext) {
      end = cur;
      continue;
    }
    ranges.push({ startDate: start.date, endDate: end.date, sample: start });
    start = cur;
    end = cur;
    key = curKey;
  }
  ranges.push({ startDate: start.date, endDate: end.date, sample: start });
  return ranges;
}

/**
 * HAIP availability → DerbySoft Update Inventory payloads (one per roomId).
 * ChannelAdapter.pushAvailability maps to PC inventory (availableInvCount).
 */
export function mapAvailabilityToInventory(
  hotelId: string,
  items: AvailabilityPushParams['items'],
  type: AriUpdateType,
): Array<Record<string, unknown>> {
  const byRoom = new Map<string, AvailabilityPushParams['items']>();
  for (const item of items) {
    const list = byRoom.get(item.channelRoomCode) ?? [];
    list.push(item);
    byRoom.set(item.channelRoomCode, list);
  }

  const payloads: Array<Record<string, unknown>> = [];
  for (const [roomId, roomItems] of byRoom) {
    const ranges = collapseDateRanges(roomItems, (i) => String(i.available));
    const dates = roomItems.map((i) => i.date).sort();
    payloads.push({
      header: buildHeader(),
      hotelId,
      roomId,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      type,
      inventories: ranges.map((r) => ({
        startDate: r.startDate,
        endDate: r.endDate,
        availableInvCount: r.sample.available,
      })),
    });
  }
  return payloads;
}

/**
 * HAIP rates → DerbySoft Update Rate payloads (one per roomId×rateId).
 */
export function mapRatesToDerbySoft(
  hotelId: string,
  items: RatePushParams['items'],
  type: AriUpdateType,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, RatePushParams['items']>();
  for (const item of items) {
    const key = `${item.channelRoomCode}|${item.channelRateCode}`;
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }

  const payloads: Array<Record<string, unknown>> = [];
  for (const [, rateItems] of byKey) {
    const first = rateItems[0]!;
    const ranges = collapseDateRanges(rateItems, (i) => `${i.amount}|${i.currencyCode}`);
    const dates = rateItems.map((i) => i.date).sort();
    payloads.push({
      header: buildHeader(),
      hotelId,
      roomId: first.channelRoomCode,
      rateId: first.channelRateCode,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      type,
      currencyCode: first.currencyCode,
      rates: ranges.map((r) => {
        const amt = r.sample.amount;
        const single = r.sample.singleOccupancy ?? amt;
        const baseByGuestAmts: Array<Record<string, unknown>> = [
          { ageQualifyingCode: 10, numberOfGuests: 1, amountAfterTax: single },
          { ageQualifyingCode: 10, numberOfGuests: 2, amountAfterTax: amt },
        ];
        const rate: Record<string, unknown> = {
          startDate: r.startDate,
          endDate: r.endDate,
          baseByGuestAmts,
        };
        if (r.sample.extraAdult != null || r.sample.extraChild != null) {
          const additional: Array<Record<string, unknown>> = [];
          if (r.sample.extraAdult != null) {
            additional.push({
              ageQualifyingCode: 10,
              amountAfterTax: r.sample.extraAdult,
            });
          }
          if (r.sample.extraChild != null) {
            additional.push({
              ageQualifyingCode: 8,
              amountAfterTax: r.sample.extraChild,
            });
          }
          rate['additionalGuestAmounts'] = additional;
        }
        return rate;
      }),
    });
  }
  return payloads;
}

/**
 * HAIP restrictions → DerbySoft Update Availability (product-level) payloads.
 */
export function mapRestrictionsToAvailability(
  hotelId: string,
  items: RestrictionPushParams['items'],
  type: AriUpdateType,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, RestrictionPushParams['items']>();
  for (const item of items) {
    const key = `${item.channelRoomCode}|${item.channelRateCode}`;
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }

  const payloads: Array<Record<string, unknown>> = [];
  for (const [, restItems] of byKey) {
    const first = restItems[0]!;
    const ranges = collapseDateRanges(
      restItems,
      (i) =>
        [
          i.stopSell,
          i.closedToArrival,
          i.closedToDeparture,
          i.minLos ?? 0,
          i.maxLos ?? 0,
        ].join('|'),
    );
    const dates = restItems.map((i) => i.date).sort();
    payloads.push({
      header: buildHeader(),
      hotelId,
      roomId: first.channelRoomCode,
      rateId: first.channelRateCode,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      type,
      restrictions: ranges.map((r) => ({
        startDate: r.startDate,
        endDate: r.endDate,
        masterClose: r.sample.stopSell,
        closedToArrival: r.sample.closedToArrival,
        closedToDeparture: r.sample.closedToDeparture,
        minStayArrival: r.sample.minLos ?? 0,
        maxStayArrival: r.sample.maxLos ?? 0,
      })),
    });
  }
  return payloads;
}

/** Profile Update Hotel body from HAIP property content. */
export function mapPropertyToHotelUpdate(
  hotelId: string,
  property: ContentPushParams['property'],
): Record<string, unknown> {
  return {
    header: buildHeader(),
    hotelId,
    name: property.name,
    description: property.description ?? undefined,
    address: property.address ?? undefined,
    city: property.city ?? undefined,
    countryCode: property.countryCode ?? undefined,
    starRating: property.starRating ?? undefined,
    amenities: property.amenities ?? [],
  };
}

export function mapRoomTypesToUpdates(
  hotelId: string,
  roomTypes: ContentPushParams['roomTypes'],
): Array<Record<string, unknown>> {
  return roomTypes.map((rt) => ({
    header: buildHeader(),
    hotelId,
    roomId: rt.channelRoomCode,
    name: rt.name,
    description: rt.description ?? undefined,
    maxOccupancy: rt.maxOccupancy ?? undefined,
    bedType: rt.bedType ?? undefined,
    amenities: rt.amenities ?? [],
  }));
}

/**
 * Map DerbySoft Book/Modify JSON → HAIP ChannelReservation.
 * PCI: payment card fields are stripped and never copied into rawPayload.
 */
export function mapDerbySoftReservationToHaip(
  body: Record<string, unknown>,
  status: 'new' | 'modified' | 'cancelled',
): ChannelReservation {
  const reservationIds = (body['reservationIds'] ?? {}) as Record<string, unknown>;
  const stayRange = (body['stayRange'] ?? {}) as Record<string, unknown>;
  const contact = (body['contactPerson'] ?? {}) as Record<string, unknown>;
  const guests = (body['guests'] as Array<Record<string, unknown>> | undefined) ?? [];
  const primaryGuest = guests[0] ?? contact;
  const roomCriteria = (body['roomCriteria'] ?? {}) as Record<string, unknown>;
  const roomRate = (body['roomRate'] ?? {}) as Record<string, unknown>;
  const total = (body['total'] ?? {}) as Record<string, unknown>;
  const distributorId = String(body['distributorId'] ?? 'derbysoft');

  const derbyResId = String(reservationIds['derbyResId'] ?? '');
  const distributorResId = String(reservationIds['distributorResId'] ?? derbyResId);

  const amountAfter = total['amountAfterTax'] ?? total['amountBeforeTax'] ?? '0';
  const comments = body['comments'];
  const specialRequests = Array.isArray(comments)
    ? comments.map(String).join('; ')
    : undefined;

  // Strip payment — never persist PAN/CVV/expiry (PCI DSS).
  const safeRaw = { ...body };
  delete safeRaw['payment'];
  delete safeRaw['threeDomainSecurity'];

  return {
    externalConfirmation: derbyResId || distributorResId,
    channelCode: `derbysoft:${distributorId}`,
    channelHotelId: body['hotelId'] != null ? String(body['hotelId']) : undefined,
    guestFirstName: String(
      primaryGuest['firstNameRoma'] ?? primaryGuest['firstName'] ?? contact['firstNameRoma'] ?? contact['firstName'] ?? 'Guest',
    ),
    guestLastName: String(
      primaryGuest['lastNameRoma'] ?? primaryGuest['lastName'] ?? contact['lastNameRoma'] ?? contact['lastName'] ?? 'Unknown',
    ),
    guestEmail: (primaryGuest['email'] ?? contact['email']) as string | undefined,
    guestPhone: (primaryGuest['phone'] ?? contact['phone']) as string | undefined,
    channelRoomCode: String(roomRate['roomId'] ?? ''),
    channelRateCode: String(roomRate['rateId'] ?? ''),
    arrivalDate: String(stayRange['checkin'] ?? ''),
    departureDate: String(stayRange['checkout'] ?? ''),
    adults: Number(roomCriteria['adultCount'] ?? 1),
    children: Number(roomCriteria['childCount'] ?? 0),
    totalAmount: Number(amountAfter),
    currencyCode: String(roomRate['currency'] ?? 'USD'),
    specialRequests,
    status,
    channelBookingDate: new Date(),
    rawPayload: {
      ...safeRaw,
      sourceDistributorId: distributorId,
      distributorResId,
      derbyResId,
    },
  };
}

export function mapCancelToHaip(body: Record<string, unknown>): ChannelReservation {
  const reservationIds = (body['reservationIds'] ?? {}) as Record<string, unknown>;
  const derbyResId = String(reservationIds['derbyResId'] ?? '');
  const distributorId = String(body['distributorId'] ?? 'derbysoft');
  return {
    externalConfirmation: derbyResId || String(reservationIds['distributorResId'] ?? ''),
    channelCode: `derbysoft:${distributorId}`,
    channelHotelId: body['hotelId'] != null ? String(body['hotelId']) : undefined,
    guestFirstName: 'Guest',
    guestLastName: 'Unknown',
    channelRoomCode: '',
    channelRateCode: '',
    arrivalDate: '',
    departureDate: '',
    adults: 0,
    children: 0,
    totalAmount: 0,
    currencyCode: 'USD',
    status: 'cancelled',
    channelBookingDate: new Date(),
    rawPayload: {
      reservationIds,
      distributorId,
      hotelId: body['hotelId'],
    },
  };
}

/** Build Book/Modify success response with PMS confirmation. */
export function buildBookResponse(
  body: Record<string, unknown>,
  supplierResId: string,
): Record<string, unknown> {
  const reservationIds = (body['reservationIds'] ?? {}) as Record<string, unknown>;
  const header = (body['header'] as DerbySoftHeader | undefined) ?? buildHeader();
  return {
    header: { ...header, timeStamp: new Date().toISOString() },
    reservationIds: {
      distributorResId: reservationIds['distributorResId'],
      derbyResId: reservationIds['derbyResId'],
      supplierResId,
    },
  };
}

export function buildCancelResponse(
  body: Record<string, unknown>,
  cancellationId: string,
): Record<string, unknown> {
  const reservationIds = (body['reservationIds'] ?? {}) as Record<string, unknown>;
  const header = (body['header'] as DerbySoftHeader | undefined) ?? buildHeader();
  return {
    header: { ...header, timeStamp: new Date().toISOString() },
    reservationIds: {
      distributorResId: reservationIds['distributorResId'],
      derbyResId: reservationIds['derbyResId'],
      supplierResId: reservationIds['supplierResId'],
      cancellationId,
    },
  };
}

export function buildErrorResponse(
  echoToken: string | undefined,
  errorCode: string,
  errorMessage: string,
): Record<string, unknown> {
  return {
    header: buildHeader(echoToken),
    errorCode,
    errorMessage,
  };
}
