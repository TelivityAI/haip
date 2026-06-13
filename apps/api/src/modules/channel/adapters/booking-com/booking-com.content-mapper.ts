import type { ContentPushParams, ContentMediaItem } from '../../channel-adapter.interface';

/**
 * Booking.com content mapping — JSON REST (Photo API + Rooms/Facilities/
 * Property-Description APIs). NOT OTA XML.
 *
 * VERIFIED from Booking.com Connectivity docs:
 *  - Photo API: POST /properties/{property_id}/pending/photos
 *    body { photos: [{ url, tag_ids[] }] }; photos enter a pending queue and are
 *    processed/moderated asynchronously, then moved to property/room galleries.
 *    Limits: image/jpeg|png only; 300x300..14000x14000 px (1280x900 recommended);
 *    <= 50,000,000 bytes (50 MB); <= 299 photos per property.
 *    Sources: developers.booking.com/connectivity/docs/photo-api/managing-photos,
 *    /understanding-the-photo-api, /managing-photo-galleries.
 *  - Room descriptions/config: Rooms API; amenities: Facilities API using RMA
 *    (Room Amenity Type, OTA 2014B) codes (/codes-rma). Property/room descriptions:
 *    Property-Details/Description API.
 *
 * Doc-access caveat: the Rooms/Facilities/Property-Description OpenAPI specs are
 * gated; the exact request field names below are modeled to the documented module
 * shapes and marked `VERIFY` — confirm in the Booking.com certification sandbox.
 */

export const BOOKING_PHOTO_LIMITS = {
  maxPerProperty: 299,
  maxBytes: 50_000_000,
  minDimension: 300,
  maxDimension: 14_000,
  allowedContentTypes: ['image/jpeg', 'image/png'],
  allowedExtensions: ['.jpg', '.jpeg', '.png'],
} as const;

export interface PhotoValidationResult {
  accepted: ContentMediaItem[];
  rejected: Array<{ url: string; reason: string }>;
}

/**
 * Validate HAIP media against the real Booking.com Photo API limits. Dimension/
 * size checks only apply when metadata is known (stock URLs have none) — format
 * is checked via contentType or URL extension.
 */
export function validatePhotosForBooking(images: ContentMediaItem[]): PhotoValidationResult {
  const accepted: ContentMediaItem[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];

  for (const img of images) {
    if (accepted.length >= BOOKING_PHOTO_LIMITS.maxPerProperty) {
      rejected.push({ url: img.url, reason: `exceeds max ${BOOKING_PHOTO_LIMITS.maxPerProperty} photos/property` });
      continue;
    }
    if (!isAllowedFormat(img)) {
      rejected.push({ url: img.url, reason: 'unsupported format (jpeg/png only)' });
      continue;
    }
    if (img.fileSize != null && img.fileSize > BOOKING_PHOTO_LIMITS.maxBytes) {
      rejected.push({ url: img.url, reason: `exceeds ${BOOKING_PHOTO_LIMITS.maxBytes} bytes` });
      continue;
    }
    if (
      (img.width != null && img.width < BOOKING_PHOTO_LIMITS.minDimension) ||
      (img.height != null && img.height < BOOKING_PHOTO_LIMITS.minDimension)
    ) {
      rejected.push({ url: img.url, reason: `below ${BOOKING_PHOTO_LIMITS.minDimension}x${BOOKING_PHOTO_LIMITS.minDimension}px` });
      continue;
    }
    if (
      (img.width != null && img.width > BOOKING_PHOTO_LIMITS.maxDimension) ||
      (img.height != null && img.height > BOOKING_PHOTO_LIMITS.maxDimension)
    ) {
      rejected.push({ url: img.url, reason: `above ${BOOKING_PHOTO_LIMITS.maxDimension}px` });
      continue;
    }
    accepted.push(img);
  }
  return { accepted, rejected };
}

function isAllowedFormat(img: ContentMediaItem): boolean {
  const ct = img.contentType;
  if (ct) return (BOOKING_PHOTO_LIMITS.allowedContentTypes as readonly string[]).includes(ct.toLowerCase());
  const url = img.url.toLowerCase().split('?')[0] ?? '';
  return BOOKING_PHOTO_LIMITS.allowedExtensions.some((ext) => url.endsWith(ext));
}

/**
 * HAIP media.category → Booking.com photo tag_ids. Booking's photo tag list is a
 * separate numeric code list not fully readable here; this map is intentionally
 * sparse and omits unknown categories (better to send no tag than a wrong one).
 * TODO: load the live tag list from the Booking.com tags endpoint and complete.
 */
export const BOOKING_CATEGORY_TAGS: Record<string, number[]> = {
  // VERIFY tag ids against Booking.com photo tag code list before production.
};

export interface BookingPendingPhotosBody {
  photos: Array<{ url: string; tag_ids?: number[] }>;
}

export function mapMediaToBookingPhotos(images: ContentMediaItem[]): BookingPendingPhotosBody {
  return {
    photos: images.map((m) => {
      const tags = BOOKING_CATEGORY_TAGS[m.category];
      return tags && tags.length ? { url: m.url, tag_ids: tags } : { url: m.url };
    }),
  };
}

/**
 * HAIP amenity strings → Booking.com RMA (Room Amenity Type) codes.
 * Sparse seed; complete from /codes-rma. VERIFY.
 */
export const HAIP_AMENITY_TO_RMA: Record<string, number> = {
  // e.g. 'wifi': <code>, 'minibar': <code> — VERIFY against /codes-rma.
};

export function mapAmenitiesToRma(amenities: string[] = []): number[] {
  return amenities.map((a) => HAIP_AMENITY_TO_RMA[a]).filter((c): c is number => c != null);
}

/** Rooms API room body (VERIFY field names against the Rooms API OpenAPI spec). */
export function mapRoomTypeToBookingRoom(rt: ContentPushParams['roomTypes'][number]) {
  return {
    // VERIFY: Rooms API request schema.
    partner_reference_id: rt.channelRoomCode,
    name: rt.name,
    description: rt.description ?? undefined,
    max_occupancy: rt.maxOccupancy ?? undefined,
    bed_configuration: rt.bedType ? [{ bed_type: rt.bedType }] : undefined,
    amenity_codes: mapAmenitiesToRma(rt.amenities),
  };
}

/** Property-Description API body (VERIFY). */
export function mapPropertyDescription(property: ContentPushParams['property']) {
  return {
    // VERIFY: Property-Details/Description API request schema.
    name: property.name,
    description: property.description ?? undefined,
  };
}
