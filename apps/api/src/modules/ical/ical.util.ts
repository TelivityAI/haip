export interface IcalBusyBlock {
  externalUid: string;
  startDate: string;
  endDate: string;
  summary?: string;
}

export interface IcalExportEvent {
  uid: string;
  startDate: string;
  endDate: string;
  summary: string;
  timestamp?: Date;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

export function parseIcsBusyBlocks(ics: string): IcalBusyBlock[] {
  const lines = unfoldIcalLines(ics);
  const blocks: IcalBusyBlock[] = [];
  let current: ContentLine[] | null = null;
  let eventIndex = 0;

  for (const raw of lines) {
    const line = parseContentLine(raw);
    if (!line) continue;

    if (line.name === 'BEGIN' && line.value.toUpperCase() === 'VEVENT') {
      current = [];
      continue;
    }
    if (line.name === 'END' && line.value.toUpperCase() === 'VEVENT') {
      if (current) {
        const block = eventToBusyBlock(current, eventIndex++);
        if (block) blocks.push(block);
      }
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  return blocks;
}

export function mergeBusyBlocks(blocks: IcalBusyBlock[]): IcalBusyBlock[] {
  const sorted = [...blocks].sort((a, b) => (
    a.startDate.localeCompare(b.startDate) ||
    a.endDate.localeCompare(b.endDate) ||
    a.externalUid.localeCompare(b.externalUid)
  ));
  const merged: IcalBusyBlock[] = [];

  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (!last || block.startDate > last.endDate) {
      merged.push({ ...block });
      continue;
    }

    if (block.endDate > last.endDate) {
      last.endDate = block.endDate;
    }
    if (!last.summary && block.summary) {
      last.summary = block.summary;
    }
  }

  return merged;
}

export function buildIcsCalendar(events: IcalExportEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HAIP//iCal Bridge//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    const stamp = formatUtcTimestamp(event.timestamp ?? new Date());
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${event.startDate.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${event.endDate.replaceAll('-', '')}`,
      `SUMMARY:${escapeText(event.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function unfoldIcalLines(ics: string): string[] {
  const rawLines = ics.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];

  for (const raw of rawLines) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }

  return lines;
}

function parseContentLine(raw: string): ContentLine | null {
  const colon = raw.indexOf(':');
  if (colon <= 0) return null;

  const head = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const segments = head.split(';');
  const first = segments[0];
  if (!first) return null;

  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    params[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1);
  }

  return {
    name: first.toUpperCase(),
    params,
    value,
  };
}

function eventToBusyBlock(lines: ContentLine[], index: number): IcalBusyBlock | null {
  const byName = new Map<string, ContentLine>();
  for (const line of lines) {
    if (!byName.has(line.name)) byName.set(line.name, line);
  }

  const start = byName.get('DTSTART');
  if (!start) return null;

  const end = byName.get('DTEND');
  const uid = byName.get('UID')?.value;
  const summary = unescapeText(byName.get('SUMMARY')?.value ?? '');
  const startDate = parseIcalDate(start);
  if (!startDate) return null;

  const endDate = end ? parseIcalDate(end) : null;
  const normalizedEnd = normalizeEndDate(startDate, endDate);
  if (normalizedEnd <= startDate.date) return null;

  return {
    externalUid: truncate(uid || `event-${index}-${startDate.date}-${normalizedEnd}`, 255),
    startDate: startDate.date,
    endDate: normalizedEnd,
    ...(summary ? { summary: truncate(summary, 255) } : {}),
  };
}

function parseIcalDate(line: ContentLine): { date: string; isDateOnly: boolean; endsAtMidnight: boolean } | null {
  const value = line.value.trim();
  if (/^\d{8}$/.test(value) || line.params['VALUE']?.toUpperCase() === 'DATE') {
    return {
      date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
      isDateOnly: true,
      endsAtMidnight: true,
    };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  if (!y || !mo || !d || !h || !mi || !s) return null;
  const date = new Date(Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ));

  return {
    date: date.toISOString().slice(0, 10),
    isDateOnly: false,
    endsAtMidnight: h === '00' && mi === '00' && s === '00',
  };
}

function normalizeEndDate(
  start: { date: string; isDateOnly: boolean },
  end: { date: string; isDateOnly: boolean; endsAtMidnight: boolean } | null,
): string {
  if (!end) return addDays(start.date, 1);
  if (end.isDateOnly || end.endsAtMidnight) {
    return end.date > start.date ? end.date : addDays(start.date, 1);
  }
  return addDays(end.date, 1);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
