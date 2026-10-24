import { describe, expect, it } from 'vitest';
import { bookingEntry, paymentReturnEntry } from './paymentReturn';

describe('bookingEntry', () => {
  it('deep-links payment return', () => {
    const reference = 'A'.repeat(43);
    expect(
      bookingEntry(`https://hotel.example/stays/book?haip_payment_return=${reference}`),
    ).toBe(`/payment-return?reference=${reference}`);
  });

  it('deep-links /booking/check-in with token', () => {
    expect(
      bookingEntry('https://api.example/booking/check-in?token=abc&step=pay'),
    ).toBe('/check-in?token=abc&step=pay');
  });

  it('deep-links bare /check-in (Vite standalone)', () => {
    expect(bookingEntry('http://localhost:5174/check-in?token=xyz')).toBe(
      '/check-in?token=xyz',
    );
  });

  it('falls back to search for other paths', () => {
    expect(bookingEntry('https://hotel.example/booking/')).toBe('/');
    expect(bookingEntry('https://hotel.example/stays/book?redsys=ok')).toBe('/');
  });

  it('keeps paymentReturnEntry alias', () => {
    expect(paymentReturnEntry('https://hotel.example/')).toBe('/');
  });
});
