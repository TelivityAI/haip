import { describe, expect, it } from 'vitest';
import { findingsFromChecks } from './findings-from-checks.js';
import type { CheckResult } from './types.js';

function check(partial: Partial<CheckResult> & Pick<CheckResult, 'id' | 'status'>): CheckResult {
  return {
    label: partial.id,
    command: 'echo',
    exitCode: partial.status === 'failed' ? 1 : 0,
    durationMs: 10,
    summary: partial.status,
    evidence: [],
    ...partial,
  };
}

describe('findingsFromChecks', () => {
  it('ignores passed and not_run', () => {
    const findings = findingsFromChecks(
      {
        lint: check({ id: 'lint', status: 'passed' }),
        test: check({ id: 'test', status: 'not_run' }),
      },
      'abc',
      't',
    );
    expect(findings).toHaveLength(0);
  });

  it('marks failed as observedFailure', () => {
    const findings = findingsFromChecks(
      { lint: check({ id: 'lint', status: 'failed' }) },
      'abc',
      't',
    );
    expect(findings[0].observedFailure).toBe(true);
    expect(findings[0].evidenceClass).toBe('fact');
  });

  it('distinguishes timeout', () => {
    const findings = findingsFromChecks(
      { typecheck: check({ id: 'typecheck', status: 'timeout' }) },
      'abc',
      't',
    );
    expect(findings[0].id).toContain('timeout');
    expect(findings[0].suggestedAction.toLowerCase()).toContain('timeout');
  });
});
