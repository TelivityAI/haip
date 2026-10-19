import { describe, expect, it } from 'vitest';
import { compareSnapshots } from './compare.js';
import type { SnapshotV1 } from './types.js';

function base(partial: Partial<SnapshotV1> & { findings: SnapshotV1['findings'] }): SnapshotV1 {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    repoRoot: '/tmp',
    configPath: '/tmp/config.yaml',
    productSummary: 'test',
    git: {
      branch: 'main',
      commit: 'abc',
      shortCommit: 'abc',
      dirty: false,
      dirtyPaths: [],
      analyzedCommit: 'abc',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      stale: false,
      staleReason: null,
    },
    checks: {},
    capabilities: [],
    recentChanges: { commits: [], uncommitted: [] },
    nextActions: [],
    runtime: { status: 'not_connected', note: 'n/a', sources: [] },
    collectors: [],
    graphify: {
      status: 'missing',
      dir: null,
      htmlPath: null,
      jsonPath: null,
      reportPath: null,
      nodeCount: null,
      edgeCount: null,
      summary: 'missing',
    },
    manifests: {},
    structure: {},
    previousSnapshotId: null,
    comparison: null,
    ...partial,
  };
}

describe('compareSnapshots', () => {
  it('returns null without previous', () => {
    expect(compareSnapshots(base({ findings: [] }), null)).toBeNull();
  });

  it('classifies new, resolved, recurring', () => {
    const prev = base({
      generatedAt: '2026-01-01T00:00:00.000Z',
      findings: [
        finding('a'),
        finding('b'),
      ],
    });
    const cur = base({
      generatedAt: '2026-01-02T00:00:00.000Z',
      findings: [finding('b'), finding('c')],
    });
    const cmp = compareSnapshots(cur, prev)!;
    expect(cmp.newFindingIds).toEqual(['c']);
    expect(cmp.resolvedFindingIds).toEqual(['a']);
    expect(cmp.recurringFindingIds).toEqual(['b']);
  });
});

function finding(id: string): SnapshotV1['findings'][number] {
  return {
    id,
    category: 'other',
    capability: null,
    severity: 'low',
    confidence: 'high',
    evidenceClass: 'fact',
    title: id,
    explanation: id,
    evidence: [],
    analyzedCommit: 'abc',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    suggestedAction: 'x',
    verificationLimits: 'x',
  };
}
