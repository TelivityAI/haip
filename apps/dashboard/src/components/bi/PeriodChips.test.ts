import { describe, it, expect } from 'vitest';
import { periodRange } from './PeriodChips';

describe('periodRange', () => {
  const now = new Date('2026-08-16T12:00:00Z');

  it('resolves today vs yesterday compare', () => {
    const r = periodRange('today', now);
    expect(r.date).toBe('2026-08-16');
    expect(r.compareDate).toBe('2026-08-15');
  });

  it('resolves 7d window', () => {
    const r = periodRange('7d', now);
    expect(r.startDate).toBe('2026-08-10');
    expect(r.endDate).toBe('2026-08-16');
  });

  it('resolves mtd from month start', () => {
    const r = periodRange('mtd', now);
    expect(r.startDate).toBe('2026-08-01');
    expect(r.endDate).toBe('2026-08-16');
  });
});
