import { describe, expect, it, vi } from 'vitest';
import { generateConfirmationNumber } from './confirmation-number';

describe('generateConfirmationNumber', () => {
  it('uses cryptographically random 128-bit entropy via an injectable seam', () => {
    const entropy = vi.fn((bytes: number) => Buffer.alloc(bytes, 0xa5));

    const confirmation = generateConfirmationNumber(entropy);

    expect(entropy).toHaveBeenCalledWith(16);
    expect(confirmation).toMatch(/^HAIP-[0-9A-HJKMNP-TV-Z]{32}$/);
  });
});
