import type { CheckResult, Finding } from './types.js';

export function findingsFromChecks(
  checks: Record<string, CheckResult>,
  analyzedCommit: string,
  analyzedAt: string,
): Finding[] {
  const out: Finding[] = [];
  for (const check of Object.values(checks)) {
    if (check.status === 'passed' || check.status === 'not_run' || check.status === 'stale') {
      continue;
    }
    const severity =
      check.id === 'test' || check.id === 'build'
        ? 'critical'
        : check.status === 'timeout'
          ? 'high'
          : 'high';
    out.push({
      id: `check-${check.id}-${check.status}`,
      category: 'check_failure',
      capability: null,
      severity,
      confidence: 'high',
      evidenceClass: 'fact',
      title: `${check.label} ${check.status}`,
      explanation: check.summary,
      evidence: check.evidence,
      analyzedCommit,
      analyzedAt,
      suggestedAction:
        check.status === 'timeout'
          ? `Re-run \`${check.command}\` with a higher timeout or split the suite.`
          : check.status === 'unavailable'
            ? `Install/fix the tool so \`${check.command}\` can run.`
            : `Fix the failure from \`${check.command}\` and re-analyze.`,
      verificationLimits: 'Based on collector command exit status only.',
      observedFailure: check.status === 'failed' || check.status === 'timeout',
    });
  }
  return out;
}
