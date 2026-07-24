import { describe, expect, it } from 'vitest';
import { buildIcsCalendar, mergeBusyBlocks, parseIcsBusyBlocks } from './ical.util';

describe('iCal utilities', () => {
  it('parses VEVENT date ranges and unfolded summaries', () => {
    const blocks = parseIcsBusyBlocks(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc-1
DTSTART;VALUE=DATE:20260901
DTEND;VALUE=DATE:20260904
SUMMARY:Booked
END:VEVENT
BEGIN:VEVENT
UID:abc-2
DTSTART:20260905T140000Z
DTEND:20260905T160000Z
SUMMARY:Owner
 hold
END:VEVENT
END:VCALENDAR`);

    expect(blocks).toEqual([
      {
        externalUid: 'abc-1',
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        summary: 'Booked',
      },
      {
        externalUid: 'abc-2',
        startDate: '2026-09-05',
        endDate: '2026-09-06',
        summary: 'Ownerhold',
      },
    ]);
  });

  it('merges overlapping and contiguous blocks from one external feed', () => {
    const merged = mergeBusyBlocks([
      { externalUid: 'b', startDate: '2026-09-03', endDate: '2026-09-05' },
      { externalUid: 'a', startDate: '2026-09-01', endDate: '2026-09-03', summary: 'Busy' },
      { externalUid: 'c', startDate: '2026-09-10', endDate: '2026-09-11' },
    ]);

    expect(merged).toEqual([
      { externalUid: 'a', startDate: '2026-09-01', endDate: '2026-09-05', summary: 'Busy' },
      { externalUid: 'c', startDate: '2026-09-10', endDate: '2026-09-11' },
    ]);
  });

  it('builds a text/calendar export without guest details', () => {
    const ics = buildIcsCalendar([
      {
        uid: 'reservation-1@haip',
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        summary: 'Busy',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:reservation-1@haip');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260901');
    expect(ics).toContain('SUMMARY:Busy');
    expect(ics).not.toContain('guest');
  });
});
