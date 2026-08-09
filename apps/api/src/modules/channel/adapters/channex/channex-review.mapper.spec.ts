import { describe, it, expect } from 'vitest';
import { mapChannexReviewToIngest } from './channex-review.mapper';

describe('mapChannexReviewToIngest', () => {
  it('maps Booking.com review payload', () => {
    const mapped = mapChannexReviewToIngest({
      id: '8b5e56bf-515c-4981-8c2a-8d19f6073c23',
      content: 'Lovely hotel',
      channel_id: 'e990a463-9524-41ec-b741-d19fcd024e06',
      ota: 'BookingCom',
      overall_score: 10,
      ota_review_id: 'OyQHKvMWfda',
      reviewer_name: 'Alice',
      received_at: '2024-08-05T07:35:21.000000',
    });

    expect(mapped).toEqual(
      expect.objectContaining({
        externalId: 'channex-ota-OyQHKvMWfda',
        guestName: 'Alice',
        rating: 5,
        reviewText: 'Lovely hotel',
        source: 'booking_com',
        stayDate: '2024-08-05',
        providerChannelId: 'e990a463-9524-41ec-b741-d19fcd024e06',
      }),
    );
  });

  it('returns null when id missing', () => {
    expect(mapChannexReviewToIngest({ ota: 'BookingCom' })).toBeNull();
  });
});
