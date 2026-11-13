/**
 * Calendar helpers for night audit. Dates are hotel business dates (YYYY-MM-DD),
 * not instants. Day math uses UTC noon so a DST shift cannot move the date.
 */

export interface ZonedLocal {
  date: string;
  yesterday: string;
  hour: number;
}

export interface NightAuditSettings {
  autoCloseEnabled?: boolean;
  autoCloseHour?: number;
  autoExtendOverdueStays?: boolean;
}

export type ClosePlan =
  | { action: 'disabled' }
  | { action: 'invalid_timezone'; error: string }
  | { action: 'skip_cutoff'; localHour: number; cutoffHour: number; localToday: string }
  | { action: 'close'; dates: string[]; localToday: string; localYesterday: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function calendarDay(value: string | null | undefined): string {
  return String(value ?? '').slice(0, 10);
}

export function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${calendarDay(dateStr)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A stay covers businessDate when arrival <= date < departure. */
export function stayCoversBusinessDate(
  arrivalDate: string | null | undefined,
  departureDate: string | null | undefined,
  businessDate: string,
): boolean {
  const arrival = calendarDay(arrivalDate);
  const departure = calendarDay(departureDate);
  const business = calendarDay(businessDate);
  return Boolean(arrival && departure && business) && arrival <= business && departure > business;
}

export function eachStayDate(startInclusive: string, endExclusive: string): string[] {
  const dates: string[] = [];
  let cursor = calendarDay(startInclusive);
  const end = calendarDay(endExclusive);
  if (!DATE_RE.test(cursor) || !DATE_RE.test(end)) return dates;
  while (cursor < end && dates.length < 366) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

/**
 * Local calendar date and hour in an IANA timezone.
 * Missing or invalid zones throw. There is no UTC fallback.
 */
export function zonedLocal(now: Date, timeZone: string | null | undefined): ZonedLocal {
  const zone = String(timeZone ?? '').trim();
  if (!zone) {
    throw new Error('missing_timezone');
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    throw new Error('invalid_timezone');
  }
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  let hour = Number(read('hour'));
  const date = `${read('year')}-${read('month')}-${read('day')}`;
  if (!DATE_RE.test(date) || Number.isNaN(hour)) {
    throw new Error('invalid_timezone');
  }
  if (hour === 24) hour = 0;
  return { date, yesterday: addCalendarDays(date, -1), hour };
}

export function datesToClose(input: {
  lastClosed: string | null;
  localYesterday: string;
  maxCatchupDays: number;
}): string[] {
  const cap = Math.max(1, input.maxCatchupDays);
  if (!input.lastClosed) {
    return [input.localYesterday];
  }
  const start = addCalendarDays(input.lastClosed, 1);
  if (start > input.localYesterday) return [];
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= input.localYesterday && dates.length < cap) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

export function planNightAuditWindow(input: {
  timeZone: string | null | undefined;
  settings?: NightAuditSettings | null;
  now: Date;
  lastClosed: string | null;
  forceWindow?: boolean;
  maxCatchupDays?: number;
}): ClosePlan {
  const settings = input.settings ?? {};
  if (settings.autoCloseEnabled === false) {
    return { action: 'disabled' };
  }
  let local: ZonedLocal;
  try {
    local = zonedLocal(input.now, input.timeZone);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_timezone';
    return { action: 'invalid_timezone', error: message };
  }
  const cutoffHour = settings.autoCloseHour ?? 2;
  if (!input.forceWindow && local.hour < cutoffHour) {
    return {
      action: 'skip_cutoff',
      localHour: local.hour,
      cutoffHour,
      localToday: local.date,
    };
  }
  return {
    action: 'close',
    localToday: local.date,
    localYesterday: local.yesterday,
    dates: datesToClose({
      lastClosed: input.lastClosed,
      localYesterday: local.yesterday,
      maxCatchupDays: input.maxCatchupDays ?? 14,
    }),
  };
}
