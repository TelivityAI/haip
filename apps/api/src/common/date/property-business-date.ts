/** Resolve a YYYY-MM-DD calendar date in an IANA timezone without server-UTC leakage. */
export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (value['year'] && value['month'] && value['day']) {
      return `${value['year']}-${value['month']}-${value['day']}`;
    }
  } catch {
    // Invalid legacy timezone values fall back to UTC, matching other PMS dates.
  }
  return now.toISOString().slice(0, 10);
}
