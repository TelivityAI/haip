import { describe, it, expect } from 'vitest';
import {
  validatePhotosForBooking,
  mapMediaToBookingPhotos,
  mapRoomTypeToBookingRoom,
  BOOKING_PHOTO_LIMITS,
} from './booking-com.content-mapper';
import type { ContentMediaItem } from '../../channel-adapter.interface';

function img(over: Partial<ContentMediaItem> & { contentType?: string | null } = {}): any {
  return {
    url: 'https://x/photo.jpg',
    category: 'room',
    caption: null,
    isPrimary: false,
    sortOrder: 0,
    width: null,
    height: null,
    fileSize: null,
    contentType: null,
    ...over,
  };
}

describe('validatePhotosForBooking', () => {
  it('accepts jpeg/png by extension when no metadata is present', () => {
    const { accepted, rejected } = validatePhotosForBooking([img(), img({ url: 'https://x/a.png' })]);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it('rejects unsupported formats', () => {
    const { accepted, rejected } = validatePhotosForBooking([img({ url: 'https://x/a.gif' })]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0]!.reason).toMatch(/format/);
  });

  it('rejects files over the 50 MB limit and images below 300px', () => {
    const res = validatePhotosForBooking([
      img({ fileSize: BOOKING_PHOTO_LIMITS.maxBytes + 1 }),
      img({ width: 200, height: 400 }),
    ]);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected.map((r) => r.reason).join()).toMatch(/bytes|below/);
  });

  it('enforces the 299-photos-per-property cap', () => {
    const many = Array.from({ length: 301 }, () => img());
    const { accepted, rejected } = validatePhotosForBooking(many);
    expect(accepted).toHaveLength(BOOKING_PHOTO_LIMITS.maxPerProperty);
    expect(rejected.length).toBe(301 - BOOKING_PHOTO_LIMITS.maxPerProperty);
  });
});

describe('mapMediaToBookingPhotos', () => {
  it('builds the pending-photos body with urls (omits tag_ids when unmapped)', () => {
    const body = mapMediaToBookingPhotos([img(), img({ url: 'https://x/b.jpg' })]);
    expect(body.photos).toEqual([{ url: 'https://x/photo.jpg' }, { url: 'https://x/b.jpg' }]);
  });
});

describe('mapRoomTypeToBookingRoom', () => {
  it('maps HAIP room type fields to the Rooms API shape', () => {
    const room = mapRoomTypeToBookingRoom({
      channelRoomCode: 'SGL_KING',
      name: 'Standard King',
      description: 'Cozy',
      maxOccupancy: 2,
      bedType: 'king',
      amenities: [],
      images: [],
    });
    expect(room.partner_reference_id).toBe('SGL_KING');
    expect(room.name).toBe('Standard King');
    expect(room.max_occupancy).toBe(2);
    expect(room.bed_configuration).toEqual([{ bed_type: 'king' }]);
  });
});
