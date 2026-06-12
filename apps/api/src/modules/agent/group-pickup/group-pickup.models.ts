/**
 * Group pickup / wash (attrition) forecasting models (KB 14.5).
 *
 * Pickup = rooms actually booked from a block vs rooms allotted.
 * Wash / attrition = the portion of a block expected NOT to be picked up.
 *
 * The model projects how many of the still-unsold rooms will eventually be
 * picked up before cutoff, derives the expected wash, and recommends how
 * aggressively the held inventory should be released back to general sale.
 * All math is deterministic and side-effect free so it can be unit-tested.
 */

export interface PickupForecastInput {
  roomsAllotted: number;
  roomsPickedUp: number;
  daysToCutoff: number;
  /** Share of remaining unsold rooms historically picked up (0..1). */
  historicalPickupRate: number;
}

export interface PickupForecast {
  projectedFinalPickup: number;
  projectedWash: number;
  washRate: number;
  recommendation: 'hold' | 'release_partial' | 'release_all';
  releaseQty: number;
}

/**
 * Booking pace factor: the closer to cutoff, the more of the remaining
 * historical pickup has already had its chance to materialise, so the
 * forecast leans more on what is already on the books. Far from cutoff
 * (>= 30 days) the full historical pickup rate applies; at cutoff (0 days)
 * essentially nothing more is expected to come in. Linearly interpolated and
 * clamped to [0, 1].
 */
export function pace(daysToCutoff: number): number {
  if (daysToCutoff <= 0) return 0;
  if (daysToCutoff >= 30) return 1;
  return daysToCutoff / 30;
}

/**
 * Forecast pickup vs wash for a single block (or a single date/room-type cut).
 */
export function forecastPickup(input: PickupForecastInput): PickupForecast {
  const roomsAllotted = Math.max(0, Math.floor(input.roomsAllotted));
  const roomsPickedUp = Math.max(0, Math.floor(input.roomsPickedUp));
  const historicalPickupRate = clamp01(input.historicalPickupRate);

  // Zero-allotment guard: nothing held, nothing to forecast or release.
  if (roomsAllotted === 0) {
    return {
      projectedFinalPickup: 0,
      projectedWash: 0,
      washRate: 0,
      recommendation: 'hold',
      releaseQty: 0,
    };
  }

  const remaining = Math.max(0, roomsAllotted - roomsPickedUp);
  const paceFactor = pace(input.daysToCutoff);

  // Projected additional pickup from the still-unsold rooms, never exceeding
  // what remains. Final pickup also can never exceed the allotment.
  const projectedAdditional = remaining * historicalPickupRate * paceFactor;
  const projectedFinalPickup = Math.min(
    roomsAllotted,
    roomsPickedUp + projectedAdditional,
  );

  const projectedWash = Math.max(0, roomsAllotted - projectedFinalPickup);
  const washRate = projectedWash / roomsAllotted;

  let recommendation: PickupForecast['recommendation'] = 'hold';
  let releaseQty = 0;
  if (washRate > 0.4) {
    recommendation = 'release_all';
    releaseQty = Math.floor(projectedWash);
  } else if (washRate > 0.2) {
    recommendation = 'release_partial';
    releaseQty = Math.floor(projectedWash / 2);
  }

  return {
    projectedFinalPickup: round2(projectedFinalPickup),
    projectedWash: round2(projectedWash),
    washRate: round2(washRate),
    recommendation,
    releaseQty,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
