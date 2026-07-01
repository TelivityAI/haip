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

/** Format occupancy rate (0–1 decimal from API) as a percentage string. */
export function formatOccupancyPercent(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${(Number(rate) * 100).toFixed(1)}%`;
}
