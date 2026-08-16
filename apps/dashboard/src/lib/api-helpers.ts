/**
 * Shared helpers for dashboard API write payloads.
 * Money fields must be decimal strings; propertyId is required on most mutations.
 */

export function moneyString(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export function requirePropertyId(propertyId: string | null): asserts propertyId is string {
  if (!propertyId) {
    throw new Error('Select a property first');
  }
}

/**
 * Assert a currency before WRITING money.
 *
 * Same idiom as requirePropertyId, and for the same reason. The dashboard used
 * to substitute a house default when the active property's code was unknown,
 * which meant a deposit or an AR ledger could be created in USD against a
 * property trading in yen — a wrong record, silently, with no error anywhere.
 * Refusing is the correct outcome: an unknown currency is a reason not to
 * write, never a reason to pick one.
 */
export function requireCurrency(currencyCode: string | null): asserts currencyCode is string {
  if (!currencyCode) {
    throw new Error('No currency for this property — select a single property first');
  }
}

/** Format occupancy rate (0–1 decimal from API) as a percentage string. */
export function formatOccupancyPercent(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${(Number(rate) * 100).toFixed(1)}%`;
}
