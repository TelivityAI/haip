import type { CollectorResult, RepoControlConfig, SnapshotV1 } from '../lib/types.js';
import { runGit } from '../lib/exec.js';

export async function collectGit(
  config: RepoControlConfig,
): Promise<{ data: SnapshotV1['git'] & { recentRaw: Array<{ sha: string; subject: string; date: string }> }; collector: CollectorResult }> {
  const started = Date.now();
  const cwd = config.repoRoot!;
  try {
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    const commit = await runGit(['rev-parse', 'HEAD'], cwd);
    const shortCommit = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    const status = await runGit(['status', '--porcelain'], cwd);
    const dirtyPaths = status
      ? status.split('\n').filter(Boolean).map((line) => line.slice(3).trim())
      : [];
    const log = await runGit(
      [
        'log',
        `-n`,
        String(config.recentCommitLimit),
        '--pretty=format:%H%x09%ad%x09%s',
        '--date=iso-strict',
      ],
      cwd,
    );
    const recentRaw = log
      ? log.split('\n').filter(Boolean).map((line) => {
          const [sha, date, ...rest] = line.split('\t');
          return { sha, date, subject: rest.join('\t') };
        })
      : [];

    const analyzedAt = new Date().toISOString();
    return {
      data: {
        branch,
        commit,
        shortCommit,
        dirty: dirtyPaths.length > 0,
        dirtyPaths,
        analyzedCommit: commit,
        analyzedAt,
        stale: false,
        staleReason: null,
        recentRaw,
      },
      collector: {
        id: 'git',
        status: 'ok',
        durationMs: Date.now() - started,
        summary: `${branch}@${shortCommit}${dirtyPaths.length ? ` dirty=${dirtyPaths.length}` : ''}`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      data: {
        branch: 'unknown',
        commit: 'unknown',
        shortCommit: 'unknown',
        dirty: false,
        dirtyPaths: [],
        analyzedCommit: 'unknown',
        analyzedAt: new Date().toISOString(),
        stale: true,
        staleReason: 'git collector failed',
        recentRaw: [],
      },
      collector: {
        id: 'git',
        status: 'failed',
        durationMs: Date.now() - started,
        summary: 'git collector failed',
        error: message,
      },
    };
  }
}

export async function collectCommitPaths(
  repoRoot: string,
  sha: string,
): Promise<string[]> {
  try {
    const out = await runGit(['show', '--name-only', '--pretty=format:', sha], repoRoot);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
