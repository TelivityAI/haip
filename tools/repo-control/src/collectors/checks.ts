import type { CheckResult, CollectorResult, RepoControlConfig } from '../lib/types.js';
import { runCommand } from '../lib/exec.js';

export async function collectChecks(
  config: RepoControlConfig,
): Promise<{ data: Record<string, CheckResult>; collector: CollectorResult }> {
  const started = Date.now();
  const results: Record<string, CheckResult> = {};

  for (const check of config.checks) {
    if (check.enabled === false) {
      results[check.id] = {
        id: check.id,
        label: check.label,
        command: check.command,
        status: 'not_run',
        exitCode: null,
        durationMs: null,
        summary: 'Disabled in config (not run).',
        evidence: [{ kind: 'other', summary: 'enabled: false in config' }],
      };
      continue;
    }

    const exec = await runCommand(check.command, {
      cwd: check.cwd ? check.cwd : config.repoRoot!,
      timeoutMs: check.timeoutMs,
    });

    let status: CheckResult['status'];
    if (exec.timedOut) status = 'timeout';
    else if (exec.unavailable) status = 'unavailable';
    else if (exec.ok) status = 'passed';
    else status = 'failed';

    const tail = (exec.stderr || exec.stdout).trim().split('\n').slice(-8).join('\n');
    results[check.id] = {
      id: check.id,
      label: check.label,
      command: check.command,
      status,
      exitCode: exec.exitCode,
      durationMs: exec.durationMs,
      summary:
        status === 'passed'
          ? `Passed in ${exec.durationMs}ms`
          : status === 'timeout'
            ? `Timed out after ${check.timeoutMs}ms`
            : status === 'unavailable'
              ? `Could not run: ${tail.slice(0, 200) || 'command unavailable'}`
              : `Failed (exit ${exec.exitCode}): ${tail.slice(0, 240) || 'no output'}`,
      evidence: [
        {
          kind: 'command',
          command: check.command,
          summary: `status=${status} exit=${exec.exitCode} durationMs=${exec.durationMs}`,
        },
      ],
    };
  }

  const failed = Object.values(results).filter((r) =>
    ['failed', 'timeout', 'unavailable'].includes(r.status),
  ).length;

  return {
    data: results,
    collector: {
      id: 'checks',
      status: 'ok',
      durationMs: Date.now() - started,
      summary: `${Object.keys(results).length} checks (${failed} failed/timeout/unavailable)`,
    },
  };
}
