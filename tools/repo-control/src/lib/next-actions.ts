import type { CapabilityResult, Finding, SnapshotV1 } from './types.js';

const SEV: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const CONF: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function buildNextActions(
  findings: Finding[],
  capabilities: CapabilityResult[],
): SnapshotV1['nextActions'] {
  const scored = [...findings].sort((a, b) => {
    const sa = SEV[a.severity] * 10 + CONF[a.confidence] + (a.observedFailure ? 5 : 0);
    const sb = SEV[b.severity] * 10 + CONF[b.confidence] + (b.observedFailure ? 5 : 0);
    return sb - sa;
  });

  const actions: SnapshotV1['nextActions'] = [];
  const used = new Set<string>();

  for (const f of scored) {
    if (actions.length >= 5) break;
    if (used.has(f.id)) continue;
    used.add(f.id);
    actions.push({
      rank: actions.length + 1,
      title: f.suggestedAction.slice(0, 120) || f.title,
      why: `${f.title} — ${f.explanation}`.slice(0, 280),
      findingIds: [f.id],
      confidence: f.confidence,
      effortEstimate: null,
    });
  }

  // Fill from incomplete capabilities if fewer than 5
  const gapCaps = capabilities.filter((c) =>
    ['partial', 'broken', 'stub_mock', 'planned_only'].includes(c.status),
  );
  for (const c of gapCaps) {
    if (actions.length >= 5) break;
    actions.push({
      rank: actions.length + 1,
      title: `Close gaps in ${c.name}`,
      why: `${c.status}: ${c.missing} Consequence: ${c.consequence}`,
      findingIds: [],
      confidence: 'medium',
      effortEstimate: null,
    });
  }

  return actions;
}

export function mapPathsToCapabilities(
  paths: string[],
  capabilities: CapabilityResult[],
): string[] {
  const hits = new Set<string>();
  for (const p of paths) {
    for (const c of capabilities) {
      if (c.files.some((f) => p === f || p.startsWith(f + '/') || f.startsWith(p))) {
        hits.add(c.id);
        continue;
      }
      if (p.includes(c.id.replace(/-/g, '')) || p.includes(c.id)) hits.add(c.id);
      // heuristic folder match
      const token = c.id.split('-')[0];
      if (token && p.includes(`/${token}`)) hits.add(c.id);
    }
  }
  return [...hits];
}
