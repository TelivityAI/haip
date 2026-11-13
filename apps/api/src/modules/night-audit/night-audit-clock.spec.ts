import { describe, expect, it } from 'vitest';
import {
  datesToClose,
  planNightAuditWindow,
  stayCoversBusinessDate,
  zonedLocal,
} from './night-audit-clock';

describe('stayCoversBusinessDate', () => {
  it('includes the arrival night and excludes the departure morning', () => {
    expect(stayCoversBusinessDate('2026-04-04', '2026-04-07', '2026-04-04')).toBe(true);
    expect(stayCoversBusinessDate('2026-04-04', '2026-04-07', '2026-04-06')).toBe(true);
    expect(stayCoversBusinessDate('2026-04-04', '2026-04-07', '2026-04-07')).toBe(false);
    expect(stayCoversBusinessDate('2026-04-08', '2026-04-10', '2026-04-06')).toBe(false);
  });
});

describe('zonedLocal', () => {
  it('reads the hotel date and hour and refuses a missing or invalid zone', () => {
    const winter = new Date('2026-01-15T07:30:00Z');
    expect(zonedLocal(winter, 'America/New_York')).toEqual({
      date: '2026-01-15',
      yesterday: '2026-01-14',
      hour: 2,
    });
    expect(() => zonedLocal(winter, '')).toThrow(/missing_timezone/);
    expect(() => zonedLocal(winter, 'Not/AZone')).toThrow(/invalid_timezone/);
  });
});

describe('planNightAuditWindow', () => {
  const now = new Date('2026-06-02T06:30:00Z');

  it('skips before the property cutoff and does not use UTC', () => {
    const plan = planNightAuditWindow({
      timeZone: 'America/Los_Angeles',
      now: new Date('2026-06-02T08:30:00Z'),
      lastClosed: '2026-06-01',
    });
    expect(plan).toMatchObject({ action: 'skip_cutoff', localHour: 1, localToday: '2026-06-02' });
  });

  it('closes from the day after the last audit through local yesterday, capped', () => {
    const plan = planNightAuditWindow({
      timeZone: 'Europe/Paris',
      now,
      lastClosed: '2026-05-01',
      maxCatchupDays: 3,
      forceWindow: true,
    });
    expect(plan).toEqual({
      action: 'close',
      localToday: '2026-06-02',
      localYesterday: '2026-06-01',
      dates: ['2026-05-02', '2026-05-03', '2026-05-04'],
    });
  });

  it('closes only local yesterday when the hotel has never completed an audit', () => {
    expect(datesToClose({ lastClosed: null, localYesterday: '2026-06-01', maxCatchupDays: 14 })).toEqual([
      '2026-06-01',
    ]);
  });

  it('reports an invalid timezone as that property’s error', () => {
    expect(
      planNightAuditWindow({ timeZone: 'Mars/Base', now, lastClosed: null }),
    ).toEqual({ action: 'invalid_timezone', error: 'invalid_timezone' });
  });
});
