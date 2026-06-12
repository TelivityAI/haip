import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
} from '../../channel-adapter.interface';

/**
 * Map HAIP ARI → Expedia EQC AR (AvailRateUpdateRQ) body.
 *
 * VERIFIED: root `<AvailRateUpdateRQ>` carries the AR namespace; auth is an
 * in-body `<Authentication>`; updates are keyed by Expedia room-type & rate-plan
 * ids over date ranges (Rate PerDay / Inventory). Exact child element names are
 * modeled to the EQC AR schema and marked VERIFY — confirm in the Expedia
 * test harness. Source: developers.expediagroup.com/supply/lodging/docs/
 * avail_and_rate_apis/avail_rates/reference/request/.
 */
function auth(username: string, password: string) {
  return { Authentication: { '@_username': username, '@_password': password } };
}

export function mapAvailabilityToExpedia(
  hotelId: string,
  username: string,
  password: string,
  items: AvailabilityPushParams['items'],
): Record<string, unknown> {
  const roomTypes = items.map((item) => ({
    '@_id': item.channelRoomCode,
    // VERIFY: AvailRateUpdate / Inventory element names.
    AvailRateUpdate: {
      DateRange: { '@_from': item.date, '@_to': item.date },
      RoomTypeUpdate: {
        '@_availableRooms': item.available,
        '@_totalInventory': item.totalInventory,
      },
    },
  }));
  return {
    ...auth(username, password),
    Hotel: { '@_id': hotelId },
    RoomType: roomTypes,
  };
}

export function mapRatesToExpedia(
  hotelId: string,
  username: string,
  password: string,
  items: RatePushParams['items'],
): Record<string, unknown> {
  const roomTypes = items.map((item) => ({
    '@_id': item.channelRoomCode,
    RatePlan: {
      '@_id': item.channelRateCode,
      AvailRateUpdate: {
        DateRange: { '@_from': item.date, '@_to': item.date },
        // VERIFY: Rate / RoomRate element names.
        Rate: { RoomRate: { '@_currency': item.currencyCode, '@_rate': item.amount } },
      },
    },
  }));
  return {
    ...auth(username, password),
    Hotel: { '@_id': hotelId },
    RoomType: roomTypes,
  };
}

export function mapRestrictionsToExpedia(
  hotelId: string,
  username: string,
  password: string,
  items: RestrictionPushParams['items'],
): Record<string, unknown> {
  const roomTypes = items.map((item) => ({
    '@_id': item.channelRoomCode,
    RatePlan: {
      '@_id': item.channelRateCode,
      AvailRateUpdate: {
        DateRange: { '@_from': item.date, '@_to': item.date },
        // VERIFY: restriction attribute names (closed/CTA/CTD/LOS).
        RestrictionStatus: {
          '@_status': item.stopSell ? 'Close' : 'Open',
          '@_closedToArrival': item.closedToArrival,
          '@_closedToDeparture': item.closedToDeparture,
          ...(item.minLos != null ? { '@_minLOS': item.minLos } : {}),
          ...(item.maxLos != null ? { '@_maxLOS': item.maxLos } : {}),
        },
      },
    },
  }));
  return {
    ...auth(username, password),
    Hotel: { '@_id': hotelId },
    RoomType: roomTypes,
  };
}
