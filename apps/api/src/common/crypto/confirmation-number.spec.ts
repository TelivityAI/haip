import { describe, expect, it, vi } from 'vitest';
import { generateConfirmationNumber } from './confirmation-number';

describe('generateConfirmationNumber', () => {
  it('uses a 128-bit cryptographic entropy seam and a non-enumerable shape', () => {
    const entropy = vi.fn((bytes: number) => Buffer.alloc(bytes, 0xa5));

    const confirmation = generateConfirmationNumber(entropy);

    expect(entropy).toHaveBeenCalledWith(16);
    expect(confirmation).toMatch(/^HAIP-[0-9A-HJKMNP-TV-Z]{32}$/);
  });
});
