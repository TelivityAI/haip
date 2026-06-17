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
