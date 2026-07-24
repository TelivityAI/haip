import { describe, expect, it } from 'vitest';
import { buildBookingDeepLink } from './deep-link';

describe('buildBookingDeepLink', () => {
  it('builds a search URL with property key and stay dates', () => {
    const url = buildBookingDeepLink({
      bookingAppOrigin: 'https://book.example.com/',
      propertyId: 'prop-1',
      bookingKey: 'bk_test',
      checkIn: '2026-08-01',
      checkOut: '2026-08-03',
      adults: 2,
    });
    expect(url).toBe(
      'https://book.example.com/?propertyId=prop-1&key=bk_test&checkIn=2026-08-01&checkOut=2026-08-03&adults=2',
    );
  });

  it('includes optional clickId for attribution', () => {
    const url = buildBookingDeepLink({
      bookingAppOrigin: 'https://book.example.com',
      propertyId: 'prop-1',
      bookingKey: 'bk_test',
      clickId: 'gha-abc',
    });
    expect(url).toContain('clickId=gha-abc');
  });
});
