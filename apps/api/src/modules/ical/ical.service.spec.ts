import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLogs, icalFeeds } from '@telivityhaip/database';
import { IcalService } from './ical.service';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const OTHER_PROPERTY_ID = 'bbbbbbbb-0000-4000-a000-000000000002';
const ROOM_TYPE_ID = 'cccccccc-0000-4000-a000-000000000003';
const FEED_ID = 'dddddddd-0000-4000-a000-000000000004';

function config() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'ICAL_SIGNING_SECRET') return 'test-ical-secret';
      if (key === 'PUBLIC_API_BASE_URL') return 'https://api.example.com';
      return undefined;
    }),
  };
}

function selectDb(rows: any[], orderByRows?: any[]) {
  let i = 0;
  return {
    select: vi.fn(() => {
      const stage = i++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => (
            stage === 1 && orderByRows
              ? { orderBy: vi.fn().mockResolvedValue(orderByRows) }
              : Promise.resolve(rows)
          )),
        })),
      };
    }),
  };
}

describe('IcalService', () => {
  let cfg: ReturnType<typeof config>;

  beforeEach(() => {
    cfg = config();
  });

  it('rejects import feed creation when the room type is outside the property', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
      insert: vi.fn(),
      transaction: vi.fn(),
    };
    const service = new IcalService(db as any, cfg as any);

    await expect(
      service.create({
        propertyId: PROPERTY_ID,
        roomTypeId: ROOM_TYPE_ID,
        direction: 'import',
        name: 'Airbnb',
        sourceUrl: 'https://calendar.example.com/a.ics',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not find a feed without a matching propertyId', async () => {
    const db = selectDb([]);
    const service = new IcalService(db as any, cfg as any);

    await expect(service.findById(FEED_ID, OTHER_PROPERTY_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates an export feed with a signed URL and stores only the token hash', async () => {
    const feed = {
      id: FEED_ID,
      propertyId: PROPERTY_ID,
      roomTypeId: ROOM_TYPE_ID,
      direction: 'export',
      name: 'Vrbo export',
      sourceUrl: null,
      tokenHash: null,
      isActive: true,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    let storedTokenHash: string | undefined;
    const auditValues = vi.fn();
    const tx = {
      insert: vi.fn((table: any) => ({
        values: vi.fn((values: any) => {
          if (table === auditLogs) {
            auditValues(values);
            return Promise.resolve();
          }
          return { returning: vi.fn().mockResolvedValue([feed]) };
        }),
      })),
      update: vi.fn((table: any) => ({
        set: vi.fn((values: any) => {
          expect(table).toBe(icalFeeds);
          storedTokenHash = values.tokenHash;
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ ...feed, tokenHash: values.tokenHash }]),
            })),
          };
        }),
      })),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ id: ROOM_TYPE_ID }]),
        })),
      })),
      transaction: vi.fn(async (cb: any) => cb(tx)),
    };
    const service = new IcalService(db as any, cfg as any);

    const result = await service.create({
      propertyId: PROPERTY_ID,
      roomTypeId: ROOM_TYPE_ID,
      direction: 'export',
      name: 'Vrbo export',
    });

    expect(result.exportUrl).toMatch(/^https:\/\/api\.example\.com\/ical\/export\.ics\?token=/);
    expect(result.feed).not.toHaveProperty('tokenHash');
    expect(storedTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: PROPERTY_ID,
      action: 'create',
      entityType: 'ical_feed',
      entityId: FEED_ID,
    }));
  });

  it('exports busy reservation blocks after token verification', async () => {
    const baseFeed = {
      id: FEED_ID,
      propertyId: PROPERTY_ID,
      roomTypeId: ROOM_TYPE_ID,
      direction: 'export',
      name: 'Google bridge',
      sourceUrl: null,
      isActive: true,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const token = (new IcalService({} as any, cfg as any) as any).signExportToken(baseFeed);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const db = selectDb(
      [{ ...baseFeed, tokenHash }],
      [{ id: 'res-1', arrivalDate: '2026-09-01', departureDate: '2026-09-04' }],
    );
    const service = new IcalService(db as any, cfg as any);

    const ics = await service.exportCalendar(token);

    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:res-1@haip');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260901');
    expect(ics).toContain('DTEND;VALUE=DATE:20260904');
  });
});
