/** Format money with the booking's currency. Falls back gracefully. */
export function money(amount: number | string, currency = 'USD'): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return String(amount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Format a YYYY-MM-DD calendar date without allowing the device timezone to shift it. */
export function calendarDate(
  value: string,
  locales?: string | string[],
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat(locales, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return value;
  }
}

/** Lowest nightly/total rate across a room type's rate options. */
export function lowestRate(rates?: { totalAmount: number }[]): number | undefined {
  if (!rates || rates.length === 0) return undefined;
  return Math.min(...rates.map((r) => r.totalAmount));
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  const n = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
