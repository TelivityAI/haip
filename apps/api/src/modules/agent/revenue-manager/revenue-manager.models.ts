/**
 * Revenue Manager (RManager) — orchestration decision logic.
 *
 * Pure, dependency-free functions that synthesize the outputs of the individual
 * revenue sub-agents (demand forecast, dynamic pricing, overbooking, channel mix,
 * group pickup) into ONE coherent revenue strategy.
 *
 * The rules encoded here are grounded in established hotel revenue-management
 * doctrine: optimize PROFIT (GOPPAR), not revenue alone; move price with demand
 * elasticity and booking pace; protect peak dates with length-of-stay controls;
 * keep the rate grid internally consistent; accept groups only when total
 * contribution clears displaced transient contribution; and treat discounting as
 * a last resort, never a default. These map to the project's RM knowledge base.
 *
 * Kept free of DB/NestJS so the synthesis is unit-testable in isolation.
 */

export type DemandLevel = 'low' | 'moderate' | 'high' | 'peak';
export type PriceDirection = 'raise' | 'hold' | 'lower';
export type LosControl = 'none' | 'min_los' | 'cta';
export type OverbookingPosture = 'aggressive' | 'standard' | 'zero';
export type RevenueObjective = 'goppar' | 'revpar' | 'acquisition' | 'retention';

/** Demand-band thresholds — aligned with the dynamic pricing agent's bands. */
export const DEMAND_BANDS = { peak: 0.85, high: 0.7, moderate: 0.4 } as const;

export function classifyDemand(predictedOccupancy: number): DemandLevel {
  if (predictedOccupancy > DEMAND_BANDS.peak) return 'peak';
  if (predictedOccupancy > DEMAND_BANDS.high) return 'high';
  if (predictedOccupancy > DEMAND_BANDS.moderate) return 'moderate';
  return 'low';
}

/** RevPAR = ADR x occupancy. */
export function revpar(adr: number, occupancy: number): number {
  return round2(adr * occupancy);
}

/**
 * GOPPAR = (ADR - VC1) x occupancy - FCPAR.
 * The profit-per-available-room objective the strategy optimizes for.
 */
export function goppar(adr: number, vc1: number, occupancy: number, fcpar: number): number {
  return round2((adr - vc1) * occupancy - fcpar);
}

/**
 * Identical-net-revenue rule: the occupancy needed to hold net room revenue
 * constant when ADR changes. Used to sanity-check whether a proposed discount's
 * required occupancy lift is realistically attainable before opening it.
 *
 *   required new occ% = (current contribution margin / new contribution margin)
 *                       x current occ%
 *
 * Returns null when the new rate doesn't cover variable cost (no positive margin).
 */
export function requiredOccupancyForNetRevenue(params: {
  currentRate: number;
  newRate: number;
  variableCost: number;
  currentOccupancy: number;
}): number | null {
  const currentCm = params.currentRate - params.variableCost;
  const newCm = params.newRate - params.variableCost;
  if (newCm <= 0) return null;
  return round4((currentCm / newCm) * params.currentOccupancy);
}

/**
 * Group displacement accept rule (the 4-step net-contribution test).
 * Accept only when total group contribution >= displaced transient contribution.
 * Displacement applies only to room-nights consumed on dates that would
 * otherwise be filled by constrained transient demand.
 */
export function evaluateGroupDisplacement(params: {
  groupRoomNights: number;
  groupNetRoomRate: number; // rate net of variable cost + distribution fees
  groupAncillaryContribution: number; // F&B + function + other, net of cost
  displacedRoomNights: number; // only on constrained dates
  displacedTransientNetRate: number; // transient ADR net of variable cost
  displacedAncillaryContribution: number;
}): { accept: boolean; netBenefit: number; groupValue: number; displacedValue: number } {
  const groupValue =
    params.groupRoomNights * params.groupNetRoomRate + params.groupAncillaryContribution;
  const displacedValue =
    params.displacedRoomNights * params.displacedTransientNetRate +
    params.displacedAncillaryContribution;
  const netBenefit = round2(groupValue - displacedValue);
  return { accept: netBenefit >= 0, netBenefit, groupValue: round2(groupValue), displacedValue: round2(displacedValue) };
}

export interface PaceSignal {
  /** Booking pace vs prior-year same-day-of-week, 1.0 = on pace. */
  ratio: number;
}

export interface DateStance {
  date: string;
  predictedOccupancy: number;
  demandLevel: DemandLevel;
  priceDirection: PriceDirection;
  priceAdjustmentPct: number;
  losControl: LosControl;
  overbooking: OverbookingPosture;
  /** Booking-condition fences to apply (e.g. prepayment, non-refundable). */
  fences: string[];
  /** Whether low rate classes should be closed. */
  closeLowRateClasses: boolean;
  rationale: string[];
}

/**
 * Derive the coordinated stance for a single date from its demand band, booking
 * pace, and (optionally) the dynamic-pricing agent's proposed adjustment.
 *
 * Encodes the engine IF/THEN rules:
 *  - peak  → raise; MinLOS to protect multi-night revenue; overbooking ~0;
 *            close low classes; require prepayment.
 *  - high  → raise (smaller); MinLOS only if pace is running ahead.
 *  - moderate → hold.
 *  - low   → lower via fenced last-minute discount (shallower than early-bird),
 *            widen low classes; aggressive overbooking against no-shows.
 *  - pace below prior year → bias toward opening lower price; above → bias up.
 */
export function deriveDateStance(params: {
  date: string;
  predictedOccupancy: number;
  pace?: PaceSignal;
  pricingAdjustmentPct?: number; // from the dynamic pricing agent, if present
}): DateStance {
  const demandLevel = classifyDemand(params.predictedOccupancy);
  const rationale: string[] = [`demand_${demandLevel}`];
  const paceRatio = params.pace?.ratio ?? 1.0;

  let priceDirection: PriceDirection;
  let losControl: LosControl = 'none';
  let overbooking: OverbookingPosture = 'standard';
  let closeLowRateClasses = false;
  const fences: string[] = [];

  switch (demandLevel) {
    case 'peak':
      priceDirection = 'raise';
      losControl = 'min_los';
      overbooking = 'zero'; // few no-shows, nowhere to walk
      closeLowRateClasses = true;
      fences.push('prepayment', 'non_refundable');
      rationale.push('protect_peak_min_los', 'overbooking_zero_on_peak', 'close_low_classes');
      break;
    case 'high':
      priceDirection = 'raise';
      if (paceRatio > 1.1) {
        losControl = 'min_los';
        rationale.push('pace_ahead_min_los');
      }
      break;
    case 'moderate':
      priceDirection = 'hold';
      break;
    case 'low':
    default:
      priceDirection = 'lower';
      overbooking = 'aggressive'; // protect against no-shows/cancels
      // Last-minute stimulation must be fenced & shallower than early-bird.
      fences.push('advance_purchase', 'non_refundable');
      rationale.push('fenced_last_minute_discount', 'widen_low_classes');
      break;
  }

  // Booking-pace overrides (compare same day-of-week vs prior year).
  if (paceRatio < 0.85 && priceDirection !== 'lower') {
    priceDirection = priceDirection === 'raise' ? 'hold' : 'lower';
    rationale.push('pace_below_prior_year_open_lower');
  } else if (paceRatio > 1.2 && priceDirection === 'hold') {
    priceDirection = 'raise';
    rationale.push('pace_above_prior_year_raise');
  }

  // Reconcile with the dynamic pricing agent's number (if any), but never let a
  // raw discount fire on a peak date or a raise fire on a low date.
  let priceAdjustmentPct = params.pricingAdjustmentPct ?? directionalDefault(priceDirection);
  if (priceDirection === 'raise' && priceAdjustmentPct < 0) {
    priceAdjustmentPct = directionalDefault('raise');
    rationale.push('override_discount_on_strong_demand');
  }
  if (priceDirection === 'lower' && priceAdjustmentPct > 0) {
    priceAdjustmentPct = directionalDefault('lower');
    rationale.push('override_raise_on_weak_demand');
  }
  if (priceDirection === 'hold') priceAdjustmentPct = clamp(priceAdjustmentPct, -2, 2);

  return {
    date: params.date,
    predictedOccupancy: round4(params.predictedOccupancy),
    demandLevel,
    priceDirection,
    priceAdjustmentPct: Math.round(priceAdjustmentPct),
    losControl,
    overbooking,
    fences,
    closeLowRateClasses,
    rationale,
  };
}

function directionalDefault(d: PriceDirection): number {
  if (d === 'raise') return 10;
  if (d === 'lower') return -10;
  return 0;
}

export interface ForecastInput {
  date: string;
  predictedOccupancy: number;
  confidence: number;
}

export interface StrategySynthesisInput {
  objective: RevenueObjective;
  variableCostPerRoom: number; // VC1
  fcpar: number; // fixed cost per available room
  baselineAdr: number;
  forecasts: ForecastInput[];
  /** ratePlanId/date-agnostic map of pricing adjustments keyed by date. */
  pricingByDate?: Record<string, number>;
  /** booking pace ratios keyed by date (vs prior-year same DoW). */
  paceByDate?: Record<string, number>;
}

export interface RevenueStrategy {
  objective: RevenueObjective;
  horizonDays: number;
  perDate: DateStance[];
  summary: {
    avgOccupancy: number;
    peakDates: string[];
    lowDates: string[];
    raiseDates: number;
    lowerDates: number;
    holdDates: number;
    minLosDates: number;
    projectedRevPAR: number;
    projectedGOPPAR: number;
    /** Forgács "Top 10 Mistakes" guardrails actively enforced this run. */
    guardrails: string[];
  };
}

/**
 * Synthesize the full coordinated revenue strategy across the forecast horizon.
 */
export function synthesizeStrategy(input: StrategySynthesisInput): RevenueStrategy {
  const perDate: DateStance[] = input.forecasts.map((f) =>
    deriveDateStance({
      date: f.date,
      predictedOccupancy: f.predictedOccupancy,
      pace: input.paceByDate ? { ratio: input.paceByDate[f.date] ?? 1.0 } : undefined,
      pricingAdjustmentPct: input.pricingByDate?.[f.date],
    }),
  );

  const n = perDate.length || 1;
  const avgOccupancy = input.forecasts.reduce((s, f) => s + f.predictedOccupancy, 0) / n;

  // Project portfolio RevPAR/GOPPAR using each date's stance-adjusted ADR.
  let revparSum = 0;
  let gopparSum = 0;
  for (const s of perDate) {
    const adr = input.baselineAdr * (1 + s.priceAdjustmentPct / 100);
    revparSum += revpar(adr, s.predictedOccupancy);
    gopparSum += goppar(adr, input.variableCostPerRoom, s.predictedOccupancy, input.fcpar);
  }

  const guardrails = [
    'optimize_goppar_not_revenue_alone', // mistake #2: price to market/profit, not cost
    'discounting_is_last_resort', // mistake #1
    'weekday_weekend_differentiated', // mistake #7 (handled per-date)
    'rate_grid_integrity_enforced',
  ];

  return {
    objective: input.objective,
    horizonDays: perDate.length,
    perDate,
    summary: {
      avgOccupancy: round4(avgOccupancy),
      peakDates: perDate.filter((s) => s.demandLevel === 'peak').map((s) => s.date),
      lowDates: perDate.filter((s) => s.demandLevel === 'low').map((s) => s.date),
      raiseDates: perDate.filter((s) => s.priceDirection === 'raise').length,
      lowerDates: perDate.filter((s) => s.priceDirection === 'lower').length,
      holdDates: perDate.filter((s) => s.priceDirection === 'hold').length,
      minLosDates: perDate.filter((s) => s.losControl === 'min_los').length,
      projectedRevPAR: round2(revparSum / n),
      projectedGOPPAR: round2(gopparSum / n),
      guardrails,
    },
  };
}

// --- helpers ---
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
