import { describe, it, expect } from 'vitest';
import { mapContentToOta } from './siteminder.content-mapper';
import type { ContentPushParams } from '../../channel-adapter.interface';

const params: ContentPushParams = {
  propertyId: 'p1',
  channelConnectionId: 'cc1',
  property: {
    name: 'Telivity Grand',
    description: 'Oceanfront resort',
    starRating: 4,
    images: [{ url: 'https://x/ext.jpg', category: 'exterior', caption: 'Exterior', isPrimary: true, sortOrder: 0 }],
  },
  roomTypes: [
    {
      channelRoomCode: 'SM_DLX',
      name: 'Deluxe',
      description: 'Ocean view',
      maxOccupancy: 3,
      bedType: 'king',
      amenities: ['balcony'],
      images: [{ url: 'https://x/dlx.jpg', category: 'room', caption: 'Deluxe', isPrimary: true, sortOrder: 0 }],
    },
  ],
};

describe('siteminder mapContentToOta', () => {
  it('builds HotelDescriptiveContent body with hotel code + rooms', () => {
    const out: any = mapContentToOta('SM-HOTEL', params);
    const c = out.HotelDescriptiveContents.HotelDescriptiveContent;
    expect(c['@_HotelCode']).toBe('SM-HOTEL');
    expect(c['@_HotelName']).toBe('Telivity Grand');
    expect(c.HotelInfo.Award['@_Rating']).toBe('4');
    const gr = c.FacilityInfo.GuestRooms.GuestRoom;
    expect(gr[0]['@_RoomTypeCode']).toBe('SM_DLX');
    expect(gr[0].ImageItems.ImageItem[0].ImageFormat.URL).toBe('https://x/dlx.jpg');
  });

  it('includes property image items', () => {
    const out: any = mapContentToOta('SM-HOTEL', params);
    const imgs = out.HotelDescriptiveContents.HotelDescriptiveContent.ImageItems.ImageItem;
    expect(imgs[0]['@_Category']).toBe('exterior');
  });
});
