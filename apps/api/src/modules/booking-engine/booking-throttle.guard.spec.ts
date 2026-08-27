import { describe, expect, it } from 'vitest';
import { BookingThrottleGuard } from './booking-throttle.guard';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('BookingThrottleGuard', () => {
  it('enforces the setup-route throttle guard once its property budget is exhausted', () => {
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const config = {
        get: (key: string, fallback: string) => {
          if (key === 'BOOKING_RATE_LIMIT_MAX') return '1';
          if (key === 'BOOKING_RATE_LIMIT_WINDOW_MS') return '60000';
          if (key === 'RATE_LIMIT_DISABLED') return 'false';
          return fallback;
        },
      } as unknown as ConstructorParameters<typeof BookingThrottleGuard>[0];
      const guard = new BookingThrottleGuard(config);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            ip: '203.0.113.10',
            bookingEngine: { propertyId: PROPERTY_ID },
          }),
        }),
      } as unknown as Parameters<BookingThrottleGuard['canActivate']>[0];

      expect(guard.canActivate(context)).toBe(true);
      expect(() => guard.canActivate(context)).toThrow(/Too many booking attempts/);
    } finally {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
    }
  });
});
