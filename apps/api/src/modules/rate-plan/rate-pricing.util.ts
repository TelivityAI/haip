/**
 * Pure rate-pricing helpers for LOS and occupancy-based adjustments.
 */

export interface RateAdjustmentRule {
  adjustmentType: 'percentage' | 'fixed';
  adjustmentValue: number;
}

export interface LosAdjustment extends RateAdjustmentRule {
  minNights: number;
}

export interface OccupancyBand extends RateAdjustmentRule {
  occupancyPctMin: number;
  occupancyPctMax: number;
}

/** Pick the highest qualifying LOS tier (e.g. 21+ beats 14+ beats 7+). */
export function selectLosAdjustment(
  adjustments: LosAdjustment[] | null | undefined,
  nights: number,
): LosAdjustment | null {
  if (!adjustments?.length || !(nights > 0)) return null;

  const qualifying = adjustments
    .filter((a) => nights >= a.minNights)
    .sort((a, b) => b.minNights - a.minNights);

  return qualifying[0] ?? null;
}

/** Pick the band that contains occupancyPct (0–100 scale). */
export function selectOccupancyBand(
  bands: OccupancyBand[] | null | undefined,
  occupancyPct: number,
): OccupancyBand | null {
  if (!bands?.length) return null;

  return (
    bands.find(
      (b) => occupancyPct >= b.occupancyPctMin && occupancyPct <= b.occupancyPctMax,
    ) ?? null
  );
}

export function applyRateAdjustment(
  baseRate: number,
  rule: RateAdjustmentRule,
): number {
  if (rule.adjustmentType === 'percentage') {
    return baseRate * (1 + rule.adjustmentValue / 100);
  }
  return baseRate + rule.adjustmentValue;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.ceil(
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000,
  );
}
