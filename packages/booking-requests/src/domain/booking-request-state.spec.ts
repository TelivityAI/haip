import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertBookingRequestTransition,
  type BookingRequestStatus,
} from './booking-request-state.js';

describe('booking request state', () => {
  it('allows only pending to accepted or denied', () => {
    expect(() => assertBookingRequestTransition('pending', 'accepted')).not.toThrow();
    expect(() => assertBookingRequestTransition('pending', 'denied')).not.toThrow();
    expect(() => assertBookingRequestTransition('accepted', 'denied')).toThrow(/accepted/);
  });

  it('rejects every transition from a terminal status with a conflict', () => {
    const statuses: BookingRequestStatus[] = ['accepted', 'denied'];
    for (const from of statuses) {
      expect(() => assertBookingRequestTransition(from, 'accepted')).toThrow(ConflictException);
      expect(() => assertBookingRequestTransition(from, 'denied')).toThrow(ConflictException);
    }
  });
});
