import type { ContentPushParams, ContentMediaItem } from '../../channel-adapter.interface';

/**
 * Map HAIP content → OTA_HotelDescriptiveContentNotifRQ body (SiteMinder).
 *
 * Same OpenTravel descriptive-content message as Booking.com; SiteMinder wraps
 * it in a SOAP envelope (buildSoapEnvelope) rather than a bare OTA envelope.
 */
export function mapContentToOta(
  hotelCode: string,
  params: ContentPushParams,
): Record<string, unknown> {
  const guestRooms = params.roomTypes.map((rt) => ({
    '@_RoomTypeCode': rt.channelRoomCode,
    ...(rt.maxOccupancy ? { '@_MaxOccupancy': rt.maxOccupancy } : {}),
    TypeDescription: rt.name,
    ...(rt.description ? { DescriptiveText: rt.description } : {}),
    ...(rt.amenities?.length
      ? { Amenities: { Amenity: rt.amenities.map((a) => ({ '@_RoomAmenityCode': a })) } }
      : {}),
    ...(rt.images.length ? { ImageItems: { ImageItem: rt.images.map(toImageItem) } } : {}),
  }));

  return {
    HotelDescriptiveContents: {
      HotelDescriptiveContent: {
        '@_HotelCode': hotelCode,
        '@_HotelName': params.property.name,
        HotelInfo: {
          '@_HotelStatusCode': '1',
          ...(params.property.description
            ? { Descriptions: { DescriptiveText: params.property.description } }
            : {}),
          ...(params.property.starRating
            ? { Award: { '@_Rating': String(params.property.starRating) } }
            : {}),
        },
        FacilityInfo: {
          GuestRooms: { GuestRoom: guestRooms },
        },
        ...(params.property.images.length
          ? { ImageItems: { ImageItem: params.property.images.map(toImageItem) } }
          : {}),
      },
    },
  };
}

function toImageItem(m: ContentMediaItem): Record<string, unknown> {
  return {
    '@_Category': m.category,
    ...(m.isPrimary ? { '@_IsPrimary': true } : {}),
    ImageFormat: { URL: m.url },
    ...(m.caption ? { Description: m.caption } : {}),
  };
}
