import { describe, expect, it } from 'vitest';
import {
  WORLDLINE_SYNC_DEADLINE_MS,
  worldlineSyncShouldContinue,
  worldlineSyncToast,
} from './worldline-sync';

describe('worldline folio sync poll', () => {
  it('keeps checking a pending challenge and stops on a finished status or the deadline', () => {
    expect(worldlineSyncShouldContinue(['pending'], 0)).toBe(true);
    expect(worldlineSyncShouldContinue(['unavailable'], 0)).toBe(true);
    expect(worldlineSyncShouldContinue(['pending'], WORLDLINE_SYNC_DEADLINE_MS - 1)).toBe(true);
    expect(worldlineSyncShouldContinue(['authorized'], 0)).toBe(false);
    expect(worldlineSyncShouldContinue(['failed'], 0)).toBe(false);
    expect(worldlineSyncShouldContinue(['captured'], 0)).toBe(false);
    expect(worldlineSyncShouldContinue(['pending', 'failed'], 0)).toBe(false);
    expect(worldlineSyncShouldContinue([], 0)).toBe(false);
    expect(worldlineSyncShouldContinue(['pending'], WORLDLINE_SYNC_DEADLINE_MS)).toBe(false);
  });

  it('toasts the latest status', () => {
    expect(worldlineSyncToast(['failed']).message).toBe('Card authorization was declined.');
    expect(worldlineSyncToast(['authorized']).message).toBe('Card authorization is held.');
    expect(worldlineSyncToast(['captured']).message).toBe('Card payment was captured.');
    expect(worldlineSyncToast(['pending']).message).toBe('Card authorization is still being checked.');
  });
});
