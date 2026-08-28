import { describe, expect, it } from 'vitest';
import { calendarDate } from './format';

describe('calendarDate', () => {
  it('localizes an ISO calendar date without applying a local timezone shift', () => {
    expect(calendarDate('2026-09-10', 'en-US')).toBe('Sep 10, 2026');
    expect(calendarDate('2026-01-01', 'en-GB')).toBe('1 Jan 2026');
  });

  it('falls back to the source value when it is not a valid calendar date', () => {
    expect(calendarDate('2026-02-30', 'en-US')).toBe('2026-02-30');
    expect(calendarDate('not-a-date', 'en-US')).toBe('not-a-date');
  });
});
