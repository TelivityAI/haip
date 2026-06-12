/**
 * Night audit anomaly detection models.
 * Rule-based (day 1) → statistical outlier detection (month 3+).
 */

export type AnomalyType =
  | 'unposted_charges'
  | 'rate_discrepancy'
  | 'missing_registration'
  | 'zero_balance_checkout'
  | 'stale_checked_in'
  | 'duplicate_folio'
  | 'unusual_charge'
  | 'missing_tax'
  | 'payment_mismatch'
  | 'no_show_candidate'
  | 'cash_variance_outlier';

export type AnomalySeverity = 'critical' | 'warning' | 'info';

export interface Anomaly {
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  affectedEntity: { type: 'reservation' | 'folio' | 'guest' | 'cash_session'; id: string };
  description: string;
  suggestedAction: string;
  confidence: number;
}

export interface ChargeProfile {
  chargeType: string;
  mean: number;
  stdDev: number;
  count: number;
}

/**
 * Detect if a charge amount is a statistical outlier.
 * Uses z-score method: outlier if |z| > threshold.
 */
export function isStatisticalOutlier(
  amount: number,
  profile: ChargeProfile,
  threshold = 2.5,
): boolean {
  if (profile.count < 30 || profile.stdDev === 0) return false;
  const zScore = Math.abs(amount - profile.mean) / profile.stdDev;
  return zScore > threshold;
}

/**
 * Build charge profiles from historical data.
 */
export function buildChargeProfiles(
  charges: Array<{ type: string; amount: number }>,
): Map<string, ChargeProfile> {
  const groups = new Map<string, number[]>();
  for (const c of charges) {
    const arr = groups.get(c.type) ?? [];
    arr.push(c.amount);
    groups.set(c.type, arr);
  }

  const profiles = new Map<string, ChargeProfile>();
  for (const [type, amounts] of groups) {
    const count = amounts.length;
    const mean = amounts.reduce((s, a) => s + a, 0) / count;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / count;
    profiles.set(type, { chargeType: type, mean, stdDev: Math.sqrt(variance), count });
  }
  return profiles;
}

/**
 * Assign severity based on anomaly type.
 */
export function getSeverity(type: AnomalyType): AnomalySeverity {
  switch (type) {
    case 'payment_mismatch':
    case 'stale_checked_in':
    case 'missing_tax':
      return 'critical';
    case 'unposted_charges':
    case 'rate_discrepancy':
    case 'zero_balance_checkout':
    case 'no_show_candidate':
    case 'unusual_charge':
      return 'warning';
    case 'cash_variance_outlier':
      return 'warning';
    case 'missing_registration':
    case 'duplicate_folio':
      return 'info';
  }
}

/**
 * Detect a cash drawer variance anomaly (KB 12.4).
 * `variance` is counted − expected, in currency units; a closed session is an
 * outlier when the absolute variance exceeds `threshold`.
 */
export function isCashVarianceAnomaly(variance: number, threshold = 5): boolean {
  return Math.abs(variance) > threshold;
}

/**
 * Sort anomalies by severity (critical first) then confidence (highest first).
 */
export function rankAnomalies(anomalies: Anomaly[]): Anomaly[] {
  const order: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...anomalies].sort((a, b) => {
    const severityDiff = order[a.severity] - order[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.confidence - a.confidence;
  });
}
