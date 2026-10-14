/** Same 30-minute deadline as the abandoned Worldline challenge job. */
export const WORLDLINE_SYNC_INTERVAL_MS = 3000;
export const WORLDLINE_SYNC_DEADLINE_MS = 30 * 60 * 1000;

const FINISHED = new Set(['authorized', 'failed', 'captured']);

/** Keep polling only while the latest read is still pending and inside the deadline. */
export function worldlineSyncShouldContinue(
  statuses: string[],
  elapsedMs: number,
  deadlineMs = WORLDLINE_SYNC_DEADLINE_MS,
): boolean {
  if (elapsedMs >= deadlineMs) return false;
  if (statuses.some((status) => FINISHED.has(status))) return false;
  return statuses.includes('pending');
}

export function worldlineSyncToast(statuses: string[]): { tone: 'error' | 'success' | 'info'; message: string } {
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
