import type { AcceptedPricingSnapshot } from '@telivityhaip/database';

export type AcceptedReservationServiceCandidate = {
  id: string;
  serviceId: string;
  status?: string | null;
  sourceChannel?: string | null;
  createdAt?: Date | string | null;
};

function createdAtValue(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Match each snapshot service to exactly one operational row. Booking Request
 * acceptance creates `booking_engine` rows; later front-desk duplicates are
 * legal extras and must never duplicate or resurrect that accepted component.
 * The time/id fallback makes legacy rows deterministic when provenance is absent.
 */
export function matchAcceptedReservationServiceRows<
  T extends AcceptedReservationServiceCandidate,
>(
  pricing: Pick<AcceptedPricingSnapshot, 'services'> | null | undefined,
  rows: readonly T[],
): Map<string, T> {
  const matched = new Map<string, T>();
  if (!pricing) return matched;

  for (const service of pricing.services) {
    const candidates = rows
      .filter((row) => row.serviceId === service.serviceId)
      .sort((left, right) => {
        const provenance = Number(right.sourceChannel === 'booking_engine')
          - Number(left.sourceChannel === 'booking_engine');
        if (provenance !== 0) return provenance;
        const created = createdAtValue(left.createdAt) - createdAtValue(right.createdAt);
        return created !== 0 ? created : left.id.localeCompare(right.id);
      });
    if (candidates[0]) matched.set(service.serviceId, candidates[0]);
  }

  return matched;
}
