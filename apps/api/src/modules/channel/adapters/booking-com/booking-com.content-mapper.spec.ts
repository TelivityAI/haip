import { describe, it, expect } from 'vitest';
import { mapContentToOta } from './booking-com.content-mapper';
import type { ContentPushParams } from '../../channel-adapter.interface';

const params: ContentPushParams = {
  propertyId: 'p1',
  channelConnectionId: 'cc1',
  property: {
    name: 'Telivity Grand',
    description: 'Oceanfront resort',
    starRating: 5,
    amenities: ['wifi', 'pool'],
    images: [{ url: 'https://x/hero.jpg', category: 'hero', caption: 'Hero', isPrimary: true, sortOrder: 0 }],
  },
  roomTypes: [
    {
      channelRoomCode: 'SGL_KING',
      name: 'Standard King',
      description: 'Cozy room',
      maxOccupancy: 2,
      bedType: 'king',
      amenities: ['wifi'],
      images: [{ url: 'https://x/std.jpg', category: 'room', caption: null, isPrimary: true, sortOrder: 0 }],
    },
  ],
};

describe('booking-com mapContentToOta', () => {
  it('builds HotelDescriptiveContent with hotel code, name and description', () => {
    const out: any = mapContentToOta('BDC-1', params);
    const c = out.HotelDescriptiveContents.HotelDescriptiveContent;
    expect(c['@_HotelCode']).toBe('BDC-1');
    expect(c['@_HotelName']).toBe('Telivity Grand');
    expect(c.HotelInfo.Descriptions.DescriptiveText).toBe('Oceanfront resort');
    expect(c.HotelInfo.Award['@_Rating']).toBe('5');
  });

  it('maps each room type to a GuestRoom with image items', () => {
    const out: any = mapContentToOta('BDC-1', params);
    const gr = out.HotelDescriptiveContents.HotelDescriptiveContent.FacilityInfo.GuestRooms.GuestRoom;
    expect(gr).toHaveLength(1);
    expect(gr[0]['@_RoomTypeCode']).toBe('SGL_KING');
    expect(gr[0]['@_MaxOccupancy']).toBe(2);
    expect(gr[0].ImageItems.ImageItem[0].ImageFormat.URL).toBe('https://x/std.jpg');
  });

  it('includes property image items with category and primary flag', () => {
    const out: any = mapContentToOta('BDC-1', params);
    const imgs = out.HotelDescriptiveContents.HotelDescriptiveContent.ImageItems.ImageItem;
    expect(imgs[0]['@_Category']).toBe('hero');
    expect(imgs[0]['@_IsPrimary']).toBe(true);
  });

  it('omits optional blocks when data is absent', () => {
    const minimal: ContentPushParams = {
      propertyId: 'p1',
      channelConnectionId: 'cc1',
      property: { name: 'Bare', images: [] },
      roomTypes: [],
    };
    const out: any = mapContentToOta('BDC-1', minimal);
    const c = out.HotelDescriptiveContents.HotelDescriptiveContent;
    expect(c.HotelInfo.Descriptions).toBeUndefined();
    expect(c.ImageItems).toBeUndefined();
    expect(c.FacilityInfo.GuestRooms.GuestRoom).toHaveLength(0);
  });
});
