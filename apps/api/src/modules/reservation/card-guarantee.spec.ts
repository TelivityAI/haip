import { describe, expect, it } from 'vitest';
import {
  resolveReservationCardGuarantee,
  sanitizeCardGuarantee,
} from './dto/card-guarantee.dto';

describe('reservation cardGuarantee sanitization & resolution', () => {
  it('retains masked summary fields and strips raw PAN / CVV keys', () => {
    const cleaned = sanitizeCardGuarantee({
      status: 'valid',
      cardBrand: 'Visa',
      last4: '4242',
      expMonth: 8,
      expYear: 2028,
      holderName: 'Sofia Martinez',
      verifiedAt: '2026-11-15T14:00:00Z',
      pan: '4242424242424242',
      cardNumber: '4242424242424242',
      cvv: '123',
    });

    expect(cleaned).toEqual({
      status: 'valid',
      cardBrand: 'Visa',
      last4: '4242',
      expMonth: 8,
      expYear: 2028,
      holderName: 'Sofia Martinez',
      verifiedAt: '2026-11-15T14:00:00Z',
      reason: null,
    });
    expect('pan' in (cleaned as Record<string, unknown>)).toBe(false);
    expect('cvv' in (cleaned as Record<string, unknown>)).toBe(false);
  });

  it('drops non-4-digit last4 values so full card numbers cannot leak through last4', () => {
    const cleaned = sanitizeCardGuarantee({
      status: 'valid',
      cardBrand: 'mastercard',
      last4: '5555444433332222',
    });
    expect(cleaned?.last4).toBeNull();
  });

  it('falls back to preferences.cardGuarantee when direct cardGuarantee column is null', () => {
    const resolved = resolveReservationCardGuarantee({
      cardGuarantee: null,
      preferences: {
        cardGuarantee: {
          status: 'expired',
          cardBrand: 'amex',
          last4: '1009',
          expMonth: 9,
          expYear: 2026,
          reason: 'Card on file expired 09/2026',
        },
      },
    });

    expect(resolved).toEqual({
      status: 'expired',
      cardBrand: 'amex',
      last4: '1009',
      expMonth: 9,
      expYear: 2026,
      holderName: null,
      verifiedAt: null,
      reason: 'Card on file expired 09/2026',
    });
  });

  it('returns null for unknown status or empty input', () => {
    expect(sanitizeCardGuarantee(null)).toBeNull();
    expect(sanitizeCardGuarantee({ status: 'bogus' })).toBeNull();
    expect(resolveReservationCardGuarantee({})).toBeNull();
  });
});
