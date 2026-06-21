import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ChannelReservation,
} from '../../channel-adapter.interface';

/**
 * Map HAIP availability items → OTA_HotelAvailNotif XML payload.
 */
export function mapAvailabilityToOta(
  hotelId: string,
  items: AvailabilityPushParams['items'],
): Record<string, unknown> {
  // Group items by channelRoomCode for efficient XML
  const byRoom = new Map<string, typeof items>();
  for (const item of items) {
    const existing = byRoom.get(item.channelRoomCode) ?? [];
    existing.push(item);
    byRoom.set(item.channelRoomCode, existing);
  }

  const availStatusMessages = [...byRoom.entries()].flatMap(
    ([roomCode, roomItems]) =>
      roomItems.map((item) => ({
        '@_BookingLimit': item.available,
        StatusApplicationControl: {
          '@_Start': item.date,
          '@_End': item.date,
          '@_InvTypeCode': roomCode,
        },
      })),
  );

  return {
    AvailStatusMessages: {
      '@_HotelCode': hotelId,
      AvailStatusMessage: availStatusMessages,
    },
  };
}

/**
 * Map HAIP rate items → OTA_HotelRateAmountNotif XML payload.
 */
export function mapRatesToOta(
  hotelId: string,
  items: RatePushParams['items'],
): Record<string, unknown> {
  const rateAmountMessages = items.map((item) => ({
    StatusApplicationControl: {
      '@_Start': item.date,
      '@_End': item.date,
      '@_InvTypeCode': item.channelRoomCode,
      '@_RatePlanCode': item.channelRateCode,
    },
    Rates: {
      Rate: {
        BaseByGuestAmts: {
          BaseByGuestAmt: {
            '@_AmountAfterTax': item.amount,
            '@_CurrencyCode': item.currencyCode,
            '@_NumberOfGuests': 2,
          },
        },
      },
    },
  }));

  return {
    RateAmountMessages: {
      '@_HotelCode': hotelId,
      RateAmountMessage: rateAmountMessages,
    },
  };
}

/**
 * Map HAIP restriction items → OTA_HotelRateAmountNotif restrictions payload.
 */
export function mapRestrictionsToOta(
  hotelId: string,
  items: RestrictionPushParams['items'],
): Record<string, unknown> {
  const rateAmountMessages = items.map((item) => ({
    StatusApplicationControl: {
      '@_Start': item.date,
      '@_End': item.date,
      '@_InvTypeCode': item.channelRoomCode,
      '@_RatePlanCode': item.channelRateCode,
    },
    Rates: {
      Rate: {
        '@_MinLOS': item.minLos ?? 1,
        '@_MaxLOS': item.maxLos ?? 999,
        HotelRef: {
          '@_CTA': item.closedToArrival,
          '@_CTD': item.closedToDeparture,
          '@_StopSell': item.stopSell,
        },
      },
    },
  }));

  return {
    RateAmountMessages: {
      '@_HotelCode': hotelId,
      RateAmountMessage: rateAmountMessages,
    },
  };
}

/**
 * Parse OTA_HotelResNotif XML data → array of HAIP ChannelReservation objects.
 */
export function mapOtaReservationToHaip(
  data: Record<string, unknown>,
): ChannelReservation[] {
  const reservations: ChannelReservation[] = [];

  const hotelReservations = extractArray(data, 'HotelReservations', 'HotelReservation');

  for (const hotelRes of hotelReservations) {
    const resStatus = (hotelRes as any)['@_ResStatus'] ?? 'Commit';

    // Map Booking.com status to HAIP status
    let status: ChannelReservation['status'] = 'new';
    if (resStatus === 'Cancel') status = 'cancelled';
    else if (resStatus === 'Modify') status = 'modified';

    // Extract guest profile
    const resGuest = (hotelRes as any).ResGuests?.ResGuest;
    const profile = resGuest?.Profiles?.ProfileInfo?.Profile;
    const personName = profile?.Customer?.PersonName ?? {};
    const guestFirstName = String(personName.GivenName ?? 'Guest');
    const guestLastName = String(personName.Surname ?? 'Unknown');
    const guestEmail = profile?.Customer?.Email
      ? String(profile.Customer.Email)
      : undefined;
    const guestPhone = profile?.Customer?.Telephone?.['@_PhoneNumber']
      ? String(profile.Customer.Telephone['@_PhoneNumber'])
      : undefined;

    // Extract room stay
    const roomStay =
      (hotelRes as any).RoomStays?.RoomStay ??
      (hotelRes as any).RoomStay ?? {};
    const roomTypeCode = String(
      roomStay.RoomTypes?.RoomType?.['@_RoomTypeCode'] ?? 'UNKNOWN',
    );
    const ratePlanCode = String(
      roomStay.RatePlans?.RatePlan?.['@_RatePlanCode'] ?? 'UNKNOWN',
    );

    // Extract dates
    const timeSpan = roomStay.TimeSpan ?? {};
    const arrivalDate = String(timeSpan['@_Start'] ?? '');
    const departureDate = String(timeSpan['@_End'] ?? '');

    // Extract total
    const total = roomStay.Total ?? {};
    const totalAmount = parseFloat(total['@_AmountAfterTax'] ?? '0');
    const currencyCode = String(total['@_CurrencyCode'] ?? 'USD');

    // Extract occupancy
    const guestCounts = roomStay.GuestCounts?.GuestCount;
    let adults = 2;
    let children = 0;
    if (Array.isArray(guestCounts)) {
      for (const gc of guestCounts) {
        if (gc['@_AgeQualifyingCode'] === 10) adults = gc['@_Count'] ?? 2;
        if (gc['@_AgeQualifyingCode'] === 8) children = gc['@_Count'] ?? 0;
      }
    }

    // Extract special requests
    const specialRequests =
      (hotelRes as any).SpecialRequests?.SpecialRequest?.Text ?? undefined;

    // External confirmation = Booking.com reservation ID
    const externalConfirmation = String(
      (hotelRes as any).UniqueID?.['@_ID'] ??
        (hotelRes as any)['@_ResID_Value'] ??
        `BDC-${Date.now()}`,
    );

    // Booking date
    const createDateStr = (hotelRes as any)['@_CreateDateTime'];
    const channelBookingDate = createDateStr
      ? new Date(createDateStr)
      : new Date();

    // OTA hotel code — routes the reservation to the right tenant's connection.
    const channelHotelId =
      roomStay.BasicPropertyInfo?.['@_HotelCode'] ??
      (hotelRes as any).BasicPropertyInfo?.['@_HotelCode'] ??
      (hotelRes as any).RoomStays?.RoomStay?.BasicPropertyInfo?.['@_HotelCode'];

    reservations.push({
      externalConfirmation,
      channelCode: 'booking_com',
      channelHotelId: channelHotelId != null ? String(channelHotelId) : undefined,
      guestFirstName,
      guestLastName,
      guestEmail,
      guestPhone,
      channelRoomCode: roomTypeCode,
      channelRateCode: ratePlanCode,
      arrivalDate,
      departureDate,
      adults,
      children,
      totalAmount,
      currencyCode,
      specialRequests: specialRequests ? String(specialRequests) : undefined,
      status,
      channelBookingDate,
      rawPayload: hotelRes as Record<string, unknown>,
    });
  }

  return reservations;
}

/**
 * Build OTA_HotelResRS confirmation XML payload.
 */
export function buildReservationConfirmation(
  externalConfirmation: string,
  pmsConfirmationNumber: string,
): Record<string, unknown> {
  return {
    Success: '',
    HotelReservations: {
      HotelReservation: {
        '@_ResStatus': 'Commit',
        UniqueID: {
          '@_Type': '14',
          '@_ID': externalConfirmation,
        },
        ResGlobalInfo: {
          HotelReservationIDs: {
            HotelReservationID: {
              '@_ResID_Type': '3',
              '@_ResID_Value': pmsConfirmationNumber,
            },
          },
        },
      },
    },
  };
}

// --- helpers ---

function extractArray(
  data: Record<string, unknown>,
  containerKey: string,
  itemKey: string,
): unknown[] {
  const container = (data as any)[containerKey];
  if (!container) return [];
  const items = container[itemKey];
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}
