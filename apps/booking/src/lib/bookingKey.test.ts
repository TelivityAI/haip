import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_BOOKING_KEY, resolveBookingKey } from './bookingKey';

describe('resolveBookingKey', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '';
  });

  it('prefers the ?key= URL query param', () => {
    window.history.replaceState({}, '', '/?key=pk_live_FROMURL');
    expect(resolveBookingKey()).toBe('pk_live_FROMURL');
  });

  it('falls back to data-booking-key on the mount element', () => {
    const el = document.createElement('div');
    el.setAttribute('data-booking-key', 'pk_live_FROMATTR');
    expect(resolveBookingKey(el)).toBe('pk_live_FROMATTR');
  });

  it('falls back to the demo key when nothing else is provided', () => {
    expect(resolveBookingKey()).toBe(DEMO_BOOKING_KEY);
  });
});
