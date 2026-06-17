import { describe, it, expect } from 'vitest';
import { generateConfirmationToken } from './connect-booking.service';

describe('generateConfirmationToken', () => {
  it('is high-entropy Crockford base32 (no ambiguous chars), fixed length', () => {
    const t = generateConfirmationToken();
    // 16 random bytes → 32 base32 chars; no I, L, O, U (Crockford).
    expect(t).toMatch(/^[0-9A-HJKMNP-TV-Z]{32}$/);
  });

  it('is non-enumerable: no collisions across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateConfirmationToken());
    expect(seen.size).toBe(5000);
  });

  it('does not embed a guessable timestamp prefix (unlike the old format)', () => {
    // The old form started with a base36 Date.now(); two tokens generated back to
    // back must not share a long common prefix.
    const a = generateConfirmationToken();
    const b = generateConfirmationToken();
    let common = 0;
    while (common < a.length && a[common] === b[common]) common++;
    expect(common).toBeLessThan(6);
  });
});
