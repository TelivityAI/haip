import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveReportDate } from './resolve-report-date';

describe('resolveReportDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the provided date when set', () => {
    expect(resolveReportDate('2026-04-06')).toBe('2026-04-06');
  });

  it('trims whitespace from the provided date', () => {
    expect(resolveReportDate('  2026-04-06  ')).toBe('2026-04-06');
  });

  it('defaults to today when date is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T15:30:00Z'));

    expect(resolveReportDate()).toBe('2026-08-09');
    expect(resolveReportDate(undefined)).toBe('2026-08-09');
    expect(resolveReportDate('')).toBe('2026-08-09');
    expect(resolveReportDate('   ')).toBe('2026-08-09');
  });
});
