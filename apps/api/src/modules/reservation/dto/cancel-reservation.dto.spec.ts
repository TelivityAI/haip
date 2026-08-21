import { describe, expect, it } from 'vitest';
import { resolveCancellationReason } from './cancel-reservation.dto';

describe('resolveCancellationReason', () => {
  it('uses cancellationReason when set', () => {
    expect(
      resolveCancellationReason({ cancellationReason: 'guest request', reason: 'ignored' }),
    ).toBe('guest request');
  });

  it('falls back to reason alias', () => {
    expect(resolveCancellationReason({ reason: 'guest request' })).toBe('guest request');
  });

  it('returns undefined when neither is set', () => {
    expect(resolveCancellationReason({})).toBeUndefined();
  });
});
