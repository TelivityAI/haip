import type { SnapshotV1 } from './types.js';

export function compareSnapshots(
  current: SnapshotV1,
  previous: SnapshotV1 | null,
): SnapshotV1['comparison'] {
  if (!previous) return null;
  const prevIds = new Set(previous.findings.map((f) => f.id));
  const curIds = new Set(current.findings.map((f) => f.id));
  const newFindingIds = [...curIds].filter((id) => !prevIds.has(id));
  const resolvedFindingIds = [...prevIds].filter((id) => !curIds.has(id));
  const recurringFindingIds = [...curIds].filter((id) => prevIds.has(id));
  return {
    previousGeneratedAt: previous.generatedAt,
    newFindingIds,
    resolvedFindingIds,
    recurringFindingIds,
  };
}
