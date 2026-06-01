/**
 * Cancellation prediction models.
 * Heuristic (day 1): lookup table by booking source × rate type.
 * Logistic regression (month 3+): trained on property's cancellation history.
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ReservationRiskScore {
  reservationId: string;
  cancellationProbability: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  daysUntilArrival: number;
  revenueAtRisk: number;
}

export interface DateAggregate {
  date: string;
  expectedCancellations: number;
  revenueAtRisk: number;
  reservationCount: number;
}

// Base cancel rates by booking source
const SOURCE_CANCEL_RATES: Record<string, number> = {
  ota: 0.25,
  gds: 0.18,
  agent: 0.15,
  phone: 0.10,
  direct: 0.08,
  corporate: 0.05,
  walk_in: 0.02,
  group: 0.12,
};

/**
 * Heuristic cancellation prediction — works with zero history.
 */
export function heuristicCancelProbability(params: {
  bookingSource: string;
  hasDeposit: boolean;
  isRepeatGuest: boolean;
  isVip: boolean;
  leadTimeDays: number;
  daysUntilArrival: number;
}): { probability: number; factors: string[] } {
  const { bookingSource, hasDeposit, isRepeatGuest, isVip, leadTimeDays, daysUntilArrival } = params;

  let prob = SOURCE_CANCEL_RATES[bookingSource] ?? 0.15;
  const factors: string[] = [];

  // Booking source
  if (prob >= 0.20) factors.push(`high_cancel_source_${bookingSource}`);

  // Deposit reduces risk
  if (hasDeposit) {
    prob *= 0.4;
    factors.push('deposit_paid');
  }

  // Repeat guests cancel less
  if (isRepeatGuest) {
    prob *= 0.6;
    factors.push('repeat_guest');
  }

  // VIP guests cancel less
  if (isVip) {
    prob *= 0.7;
    factors.push('vip_guest');
  }

  // Long lead time = higher cancel risk
  if (leadTimeDays > 90) {
    prob *= 1.4;
    factors.push('long_lead_time');
  } else if (leadTimeDays > 30) {
    prob *= 1.2;
    factors.push('moderate_lead_time');
  }

  // Cancellations cluster in last 48 hours
  if (daysUntilArrival <= 2) {
    prob *= 0.5; // if they haven't cancelled yet, less likely
    factors.push('arrival_imminent');
  } else if (daysUntilArrival <= 7) {
    prob *= 0.8;
    factors.push('arriving_soon');
  }

  prob = Math.min(0.95, Math.max(0.01, prob));

  return { probability: Math.round(prob * 1000) / 1000, factors };
}

/**
 * Classify risk level from probability.
 */
export function classifyRisk(probability: number): RiskLevel {
  if (probability >= 0.40) return 'high';
  if (probability >= 0.15) return 'medium';
  return 'low';
}

/**
 * Estimate deposit forfeit/refund exposure for a reservation with a held deposit (KB 10.4).
 *
 * A non-refundable deposit is retained as earned revenue when the guest cancels,
 * so its forfeit likelihood equals the cancellation probability. A refundable
 * deposit is returned on cancellation, so its refund likelihood equals the
 * cancellation probability. `exposure` is the deposit amount weighted by the
 * relevant likelihood. Classification is the dominant outcome (>= 0.5).
 */
export function depositForfeitRisk(params: {
  cancellationProbability: number;
  isRefundable: boolean;
  depositAmount: number;
}): {
  forfeitLikelihood: number;
  refundLikelihood: number;
  exposure: number;
  classification: 'likely_forfeit' | 'likely_refund' | 'neutral';
} {
  const { cancellationProbability, isRefundable, depositAmount } = params;

  const forfeitLikelihood = isRefundable ? 0 : cancellationProbability;
  const refundLikelihood = isRefundable ? cancellationProbability : 0;
  const relevantLikelihood = isRefundable ? refundLikelihood : forfeitLikelihood;
  const exposure = Math.round(depositAmount * relevantLikelihood * 100) / 100;

  let classification: 'likely_forfeit' | 'likely_refund' | 'neutral';
  if (forfeitLikelihood >= 0.5) {
    classification = 'likely_forfeit';
  } else if (refundLikelihood >= 0.5) {
    classification = 'likely_refund';
  } else {
    classification = 'neutral';
  }

  return { forfeitLikelihood, refundLikelihood, exposure, classification };
}

/**
 * Aggregate cancellation risk by date.
 */
export function aggregateByDate(scores: ReservationRiskScore[], arrivalDates: Map<string, string>): DateAggregate[] {
  const byDate = new Map<string, { expected: number; revenue: number; count: number }>();

  for (const score of scores) {
    const date = arrivalDates.get(score.reservationId) ?? '';
    if (!date) continue;

    const existing = byDate.get(date) ?? { expected: 0, revenue: 0, count: 0 };
    existing.expected += score.cancellationProbability;
    existing.revenue += score.revenueAtRisk;
    existing.count++;
    byDate.set(date, existing);
  }

  return [...byDate.entries()].map(([date, data]) => ({
    date,
    expectedCancellations: Math.round(data.expected * 100) / 100,
    revenueAtRisk: Math.round(data.revenue),
    reservationCount: data.count,
  }));
}
