import { describe, it, expect } from 'vitest';
import {
  calibrateSourceRates,
  heuristicCancelProbability,
  SOURCE_CANCEL_RATES,
} from './cancellation-predictor.models';

describe('calibrateSourceRates — per-property learning', () => {
  it('returns the default prior when there is no history', () => {
    expect(calibrateSourceRates([])).toEqual(SOURCE_CANCEL_RATES);
  });

  it('learns a HIGHER ota rate when this hotel cancels OTA bookings a lot', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({ source: 'ota', cancelled: i < 50 }));
    const rates = calibrateSourceRates(history);
    // (50 + 0.25*20) / (100 + 20) = 55/120 ≈ 0.458 — well above the 0.25 prior
    expect(rates.ota).toBeGreaterThan(0.4);
    expect(rates.ota).toBeGreaterThan(SOURCE_CANCEL_RATES.ota!);
  });

  it('learns a LOWER direct rate when direct bookings rarely cancel', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({ source: 'direct', cancelled: i < 2 }));
    const rates = calibrateSourceRates(history);
    expect(rates.direct).toBeLessThan(SOURCE_CANCEL_RATES.direct!);
  });

  it('stays near the prior for sparse data (empirical-Bayes smoothing)', () => {
    // one OTA booking that cancelled shouldn't swing the rate to 100%
    const rates = calibrateSourceRates([{ source: 'ota', cancelled: true }]);
    expect(rates.ota).toBeLessThan(0.35); // ≈ 0.286, anchored near the 0.25 prior
  });
});

describe('heuristicCancelProbability uses learned rates when provided', () => {
  it('starts from the learned rate instead of the default', () => {
    const learned = { ...SOURCE_CANCEL_RATES, direct: 0.40 };
    const base = { hasDeposit: false, isRepeatGuest: false, isVip: false, leadTimeDays: 10, daysUntilArrival: 10 };
    const withLearned = heuristicCancelProbability({ ...base, bookingSource: 'direct', rates: learned });
    const withDefault = heuristicCancelProbability({ ...base, bookingSource: 'direct' });
    expect(withLearned.probability).toBeGreaterThan(withDefault.probability);
  });
});
