import { describe, it, expect } from 'vitest';
import {
  heuristicCancelProbability,
  classifyRisk,
  aggregateByDate,
  depositForfeitRisk,
  type ReservationRiskScore,
} from './cancellation-predictor.models';

// ---------------------------------------------------------------------------
// heuristicCancelProbability
// ---------------------------------------------------------------------------

describe('heuristicCancelProbability', () => {
  const base = {
    bookingSource: 'direct',
    hasDeposit: false,
    isRepeatGuest: false,
    isVip: false,
    leadTimeDays: 14,
    daysUntilArrival: 14,
  };

  it('OTA reservations score higher than direct', () => {
    const ota = heuristicCancelProbability({ ...base, bookingSource: 'ota' });
    const direct = heuristicCancelProbability({ ...base, bookingSource: 'direct' });
    expect(ota.probability).toBeGreaterThan(direct.probability);
  });

  it('deposit paid reduces probability', () => {
    const noDep = heuristicCancelProbability(base);
    const dep = heuristicCancelProbability({ ...base, hasDeposit: true });
    expect(dep.probability).toBeLessThan(noDep.probability);
    expect(dep.factors).toContain('deposit_paid');
  });

  it('repeat guests score lower risk', () => {
    const newGuest = heuristicCancelProbability(base);
    const repeat = heuristicCancelProbability({ ...base, isRepeatGuest: true });
    expect(repeat.probability).toBeLessThan(newGuest.probability);
    expect(repeat.factors).toContain('repeat_guest');
  });

  it('VIP guests score lower risk', () => {
    const normal = heuristicCancelProbability(base);
    const vip = heuristicCancelProbability({ ...base, isVip: true });
    expect(vip.probability).toBeLessThan(normal.probability);
    expect(vip.factors).toContain('vip_guest');
  });

  it('long lead time increases risk', () => {
    const short = heuristicCancelProbability({ ...base, leadTimeDays: 7 });
    const long = heuristicCancelProbability({ ...base, leadTimeDays: 120 });
    expect(long.probability).toBeGreaterThan(short.probability);
    expect(long.factors).toContain('long_lead_time');
  });

  it('imminent arrival reduces probability', () => {
    const farOut = heuristicCancelProbability({ ...base, daysUntilArrival: 30 });
    const imminent = heuristicCancelProbability({ ...base, daysUntilArrival: 1 });
    expect(imminent.probability).toBeLessThan(farOut.probability);
    expect(imminent.factors).toContain('arrival_imminent');
  });

  it('caps probability between 0.01 and 0.95', () => {
    // Maximum risk scenario
    const maxRisk = heuristicCancelProbability({
      bookingSource: 'ota',
      hasDeposit: false,
      isRepeatGuest: false,
      isVip: false,
      leadTimeDays: 180,
      daysUntilArrival: 30,
    });
    expect(maxRisk.probability).toBeLessThanOrEqual(0.95);

    // Minimum risk scenario
    const minRisk = heuristicCancelProbability({
      bookingSource: 'walk_in',
      hasDeposit: true,
      isRepeatGuest: true,
      isVip: true,
      leadTimeDays: 0,
      daysUntilArrival: 1,
    });
    expect(minRisk.probability).toBeGreaterThanOrEqual(0.01);
  });

  it('prepaid/corporate books have low base rates', () => {
    const corp = heuristicCancelProbability({ ...base, bookingSource: 'corporate' });
    expect(corp.probability).toBeLessThan(0.10);
  });
});

// ---------------------------------------------------------------------------
// classifyRisk
// ---------------------------------------------------------------------------

describe('classifyRisk', () => {
  it('classifies high risk at >= 0.40', () => {
    expect(classifyRisk(0.40)).toBe('high');
    expect(classifyRisk(0.80)).toBe('high');
  });

  it('classifies medium risk at >= 0.15', () => {
    expect(classifyRisk(0.15)).toBe('medium');
    expect(classifyRisk(0.39)).toBe('medium');
  });

  it('classifies low risk below 0.15', () => {
    expect(classifyRisk(0.05)).toBe('low');
    expect(classifyRisk(0.14)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// aggregateByDate
// ---------------------------------------------------------------------------

describe('aggregateByDate', () => {
  it('sums probabilities and revenue by date', () => {
    const scores: ReservationRiskScore[] = [
      { reservationId: 'r1', cancellationProbability: 0.3, riskLevel: 'medium', riskFactors: [], daysUntilArrival: 5, revenueAtRisk: 60 },
      { reservationId: 'r2', cancellationProbability: 0.2, riskLevel: 'medium', riskFactors: [], daysUntilArrival: 5, revenueAtRisk: 40 },
      { reservationId: 'r3', cancellationProbability: 0.5, riskLevel: 'high', riskFactors: [], daysUntilArrival: 10, revenueAtRisk: 100 },
    ];
    const dates = new Map([['r1', '2026-04-10'], ['r2', '2026-04-10'], ['r3', '2026-04-15']]);

    const result = aggregateByDate(scores, dates);
    expect(result.length).toBe(2);

    const apr10 = result.find((d) => d.date === '2026-04-10')!;
    expect(apr10.expectedCancellations).toBeCloseTo(0.5, 1);
    expect(apr10.revenueAtRisk).toBe(100);
    expect(apr10.reservationCount).toBe(2);

    const apr15 = result.find((d) => d.date === '2026-04-15')!;
    expect(apr15.expectedCancellations).toBe(0.5);
    expect(apr15.revenueAtRisk).toBe(100);
  });

  it('handles empty scores', () => {
    const result = aggregateByDate([], new Map());
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// depositForfeitRisk
// ---------------------------------------------------------------------------

describe('depositForfeitRisk', () => {
  it('classifies a refundable deposit with high cancel probability as likely_refund', () => {
    const result = depositForfeitRisk({
      cancellationProbability: 0.7,
      isRefundable: true,
      depositAmount: 200,
    });
    expect(result.refundLikelihood).toBe(0.7);
    expect(result.forfeitLikelihood).toBe(0);
    expect(result.classification).toBe('likely_refund');
    expect(result.exposure).toBe(140); // 200 * 0.7
  });

  it('classifies a non-refundable deposit with high cancel probability as likely_forfeit', () => {
    const result = depositForfeitRisk({
      cancellationProbability: 0.8,
      isRefundable: false,
      depositAmount: 150,
    });
    expect(result.forfeitLikelihood).toBe(0.8);
    expect(result.refundLikelihood).toBe(0);
    expect(result.classification).toBe('likely_forfeit');
    expect(result.exposure).toBe(120); // 150 * 0.8
  });

  it('classifies low probability as neutral', () => {
    const result = depositForfeitRisk({
      cancellationProbability: 0.2,
      isRefundable: false,
      depositAmount: 100,
    });
    expect(result.classification).toBe('neutral');
    expect(result.exposure).toBe(20); // 100 * 0.2
  });
});
