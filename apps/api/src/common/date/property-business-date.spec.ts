import { describe, expect, it } from 'vitest';
import { calendarDateInTimeZone } from './property-business-date';

describe('calendarDateInTimeZone', () => {
  it('returns the property calendar date at a UTC midnight boundary', () => {
    // 2024-06-02 00:30 UTC is still 2024-06-01 evening in US Eastern.
    const instant = new Date('2024-06-02T00:30:00.000Z');
    expect(calendarDateInTimeZone(instant, 'America/New_York')).toBe('2024-06-01');
    expect(calendarDateInTimeZone(instant, 'UTC')).toBe('2024-06-02');
  });

  it('falls back to UTC when the timezone is invalid', () => {
    const instant = new Date('2024-06-02T12:00:00.000Z');
    expect(calendarDateInTimeZone(instant, 'Not/A_Timezone')).toBe('2024-06-02');
  });
});
