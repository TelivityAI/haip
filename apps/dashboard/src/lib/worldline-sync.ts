/** Same 30-minute deadline as the abandoned Worldline challenge job. */
export const WORLDLINE_SYNC_INTERVAL_MS = 3000;
export const WORLDLINE_SYNC_DEADLINE_MS = 30 * 60 * 1000;

const FINISHED = new Set(['authorized', 'failed', 'captured']);
const OPEN = new Set(['pending', 'unavailable']);

/** Keep polling while the latest read is still open and inside the deadline. */
export function worldlineSyncShouldContinue(
  statuses: string[],
  elapsedMs: number,
  deadlineMs = WORLDLINE_SYNC_DEADLINE_MS,
): boolean {
  if (elapsedMs >= deadlineMs) return false;
  if (statuses.some((status) => FINISHED.has(status))) return false;
  return statuses.some((status) => OPEN.has(status));
}

export function worldlineSyncToast(statuses: string[]): { tone: 'error' | 'success' | 'info'; message: string } | null {
  if (statuses.length === 0) return null;
  if (statuses.includes('failed')) {
    return { tone: 'error', message: 'Card authorization was declined.' };
  }
  if (statuses.includes('captured')) {
    return { tone: 'success', message: 'Card payment was captured.' };
  }
  if (statuses.includes('authorized')) {
    return { tone: 'success', message: 'Card authorization is held.' };
  }
  return { tone: 'info', message: 'Card authorization is still being checked.' };
}
