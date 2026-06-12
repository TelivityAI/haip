import { describe, it, expect } from 'vitest';
import {
  isStatisticalOutlier,
  buildChargeProfiles,
  getSeverity,
  rankAnomalies,
  isCashVarianceAnomaly,
  type Anomaly,
  type ChargeProfile,
} from './night-audit-anomaly.models';

// ---------------------------------------------------------------------------
// isStatisticalOutlier
// ---------------------------------------------------------------------------

describe('isStatisticalOutlier', () => {
  const profile: ChargeProfile = { chargeType: 'minibar', mean: 20, stdDev: 5, count: 100 };

  it('detects outlier above threshold', () => {
    // z = (50 - 20) / 5 = 6, well above 2.5
    expect(isStatisticalOutlier(50, profile)).toBe(true);
  });

  it('does not flag normal value', () => {
    // z = (25 - 20) / 5 = 1, below 2.5
    expect(isStatisticalOutlier(25, profile)).toBe(false);
  });

  it('returns false with insufficient data', () => {
    const small: ChargeProfile = { chargeType: 'minibar', mean: 20, stdDev: 5, count: 10 };
    expect(isStatisticalOutlier(100, small)).toBe(false);
  });

  it('returns false when stdDev is zero', () => {
    const flat: ChargeProfile = { chargeType: 'room', mean: 200, stdDev: 0, count: 100 };
    expect(isStatisticalOutlier(300, flat)).toBe(false);
  });

  it('uses custom threshold', () => {
    // z = (35 - 20) / 5 = 3, above 2.5 but below 4
    expect(isStatisticalOutlier(35, profile, 2.5)).toBe(true);
    expect(isStatisticalOutlier(35, profile, 4)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildChargeProfiles
// ---------------------------------------------------------------------------

describe('buildChargeProfiles', () => {
  it('builds profiles from charge data', () => {
    const charges = [
      { type: 'room', amount: 200 },
      { type: 'room', amount: 200 },
      { type: 'room', amount: 250 },
      { type: 'minibar', amount: 15 },
      { type: 'minibar', amount: 25 },
    ];
    const profiles = buildChargeProfiles(charges);

    expect(profiles.size).toBe(2);
    const room = profiles.get('room')!;
    expect(room.count).toBe(3);
    expect(room.mean).toBeCloseTo(216.67, 1);
    expect(room.stdDev).toBeGreaterThan(0);

    const minibar = profiles.get('minibar')!;
    expect(minibar.count).toBe(2);
    expect(minibar.mean).toBe(20);
  });

  it('handles empty input', () => {
    const profiles = buildChargeProfiles([]);
    expect(profiles.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSeverity
// ---------------------------------------------------------------------------

describe('getSeverity', () => {
  it('returns critical for payment_mismatch', () => {
    expect(getSeverity('payment_mismatch')).toBe('critical');
  });

  it('returns critical for stale_checked_in', () => {
    expect(getSeverity('stale_checked_in')).toBe('critical');
  });

  it('returns critical for missing_tax', () => {
    expect(getSeverity('missing_tax')).toBe('critical');
  });

  it('returns warning for unposted_charges', () => {
    expect(getSeverity('unposted_charges')).toBe('warning');
  });

  it('returns info for duplicate_folio', () => {
    expect(getSeverity('duplicate_folio')).toBe('info');
  });

  it('returns warning for cash_variance_outlier', () => {
    expect(getSeverity('cash_variance_outlier')).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// isCashVarianceAnomaly
// ---------------------------------------------------------------------------

describe('isCashVarianceAnomaly', () => {
  it('returns false when variance is within threshold', () => {
    expect(isCashVarianceAnomaly(3)).toBe(false);
    expect(isCashVarianceAnomaly(5)).toBe(false);
  });

  it('returns true when variance exceeds threshold', () => {
    expect(isCashVarianceAnomaly(10)).toBe(true);
  });

  it('returns true for a large negative variance', () => {
    expect(isCashVarianceAnomaly(-12)).toBe(true);
  });

  it('respects a custom threshold', () => {
    expect(isCashVarianceAnomaly(8, 10)).toBe(false);
    expect(isCashVarianceAnomaly(15, 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rankAnomalies
// ---------------------------------------------------------------------------

describe('rankAnomalies', () => {
  it('ranks critical before warning before info', () => {
    const anomalies: Anomaly[] = [
      { anomalyType: 'duplicate_folio', severity: 'info', affectedEntity: { type: 'reservation', id: '1' }, description: '', suggestedAction: '', confidence: 0.9 },
      { anomalyType: 'payment_mismatch', severity: 'critical', affectedEntity: { type: 'folio', id: '2' }, description: '', suggestedAction: '', confidence: 0.8 },
      { anomalyType: 'unposted_charges', severity: 'warning', affectedEntity: { type: 'reservation', id: '3' }, description: '', suggestedAction: '', confidence: 0.7 },
    ];
    const ranked = rankAnomalies(anomalies);
    expect(ranked[0]!.severity).toBe('critical');
    expect(ranked[1]!.severity).toBe('warning');
    expect(ranked[2]!.severity).toBe('info');
  });

  it('ranks by confidence within same severity', () => {
    const anomalies: Anomaly[] = [
      { anomalyType: 'unposted_charges', severity: 'warning', affectedEntity: { type: 'reservation', id: '1' }, description: '', suggestedAction: '', confidence: 0.6 },
      { anomalyType: 'rate_discrepancy', severity: 'warning', affectedEntity: { type: 'folio', id: '2' }, description: '', suggestedAction: '', confidence: 0.9 },
    ];
    const ranked = rankAnomalies(anomalies);
    expect(ranked[0]!.confidence).toBe(0.9);
    expect(ranked[1]!.confidence).toBe(0.6);
  });
});
