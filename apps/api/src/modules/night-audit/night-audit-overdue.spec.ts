import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NightAuditService } from './night-audit.service';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { ReservationService } from '../reservation/reservation.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { RoomStatusService } from '../room/room-status.service';
import { WebhookService } from '../webhook/webhook.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { PolicyService } from '../policy/policy.service';
import { DepositSettlementService } from '../accounting/deposit-settlement.service';

function dbWith(selects: unknown[][]) {
  let n = 0;
  const updates: unknown[] = [];
  const next = () => selects[n++] ?? [];
  const db: any = {
    updates,
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const rows = next();
          const promise = Promise.resolve(rows);
          return {
            limit: vi.fn().mockResolvedValue(rows),
            then: promise.then.bind(promise),
          };
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            const rows = next();
            const promise = Promise.resolve(rows);
            return { then: promise.then.bind(promise) };
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'audit-1', status: 'running' }]),
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'audit-1', status: 'running' }]),
        }),
      }),
    }),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((value: unknown) => {
        updates.push(value);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: 'audit-1',
              status: 'completed',
              summary: (value as { summary?: unknown }).summary ?? null,
            }]),
          }),
        };
      }),
    })),
  };
  return db;
}

async function serviceFor(db: any) {
  const module = await Test.createTestingModule({
    providers: [
      NightAuditService,
      { provide: DRIZZLE, useValue: db },
      { provide: FolioService, useValue: { postCharge: vi.fn(), emitSnapshotChargeWebhooks: vi.fn() } },
      { provide: ReservationService, useValue: {} },
      { provide: HousekeepingService, useValue: { generateStayoverTasks: vi.fn() } },
      { provide: RoomStatusService, useValue: { getPropertyRoomSummary: vi.fn().mockResolvedValue([{ status: 'occupied', count: 4 }]) } },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: AncillaryService, useValue: { postPerNightForProperty: vi.fn().mockResolvedValue({ errors: [] }) } },
      { provide: PolicyService, useValue: {} },
      { provide: DepositSettlementService, useValue: {} },
    ],
  }).compile();
  return module.get(NightAuditService);
}

describe('NightAuditService stay window and overdue departures', () => {
  it('does not post a room tariff for a stay that has already departed', async () => {
    const db = dbWith([[{
      id: 'res-overdue',
      status: 'checked_in',
      arrivalDate: '2026-04-01',
      departureDate: '2026-04-06',
      nights: 5,
      totalAmount: '500.00',
      currencyCode: 'USD',
      ratePlanId: 'rate-1',
      guestId: 'guest-1',
    }]]);
    const svc = await serviceFor(db);
    const result = await svc.postRoomTariffs('prop-1', '2026-04-06');
    expect(result.count).toBe(0);
    expect(result.totalRoom).toBe('0.00');
  });

  it('records an overdue_departure warning and still completes the audit', async () => {
    const db = dbWith([
      [],
      [],
      [{ settings: {} }],
      [{
        id: 'res-overdue',
        confirmationNumber: 'HG-9',
        status: 'checked_in',
        arrivalDate: '2026-04-01',
        departureDate: '2026-04-06',
        nights: 5,
        roomId: 'room-1',
      }],
      [{ roomRevenue: '0', taxRevenue: '0', totalRevenue: '0' }],
      [{ count: 0 }],
      [{ totalRooms: 4 }],
    ]);
    const svc = await serviceFor(db);
    const result = await svc.runAudit({ propertyId: 'prop-1', businessDate: '2026-04-06' });
    expect(result.alreadyRun).toBe(false);
    const summary = result.auditRun.summary as { overdueDeparturesCount?: number; mode?: string };
    expect(summary.overdueDeparturesCount).toBe(1);
    expect(summary.mode).toBe('manual');
  });

  it('extends one night only when unattended mode and the property setting are both on', async () => {
    const overdue = {
      id: 'res-overdue',
      confirmationNumber: 'HG-9',
      status: 'checked_in',
      arrivalDate: '2026-04-01',
      departureDate: '2026-04-06',
      nights: 5,
      roomId: 'room-1',
    };
    const db = dbWith([
      [{ settings: { nightAudit: { autoExtendOverdueStays: true } } }],
      [overdue],
      [{ status: 'occupied', isActive: true }],
      [],
      [],
      [],
      [{ settings: {} }],
      [],
      [{ roomRevenue: '0', taxRevenue: '0', totalRevenue: '0' }],
      [{ count: 0 }],
      [{ totalRooms: 4 }],
    ]);
    const svc = await serviceFor(db);
    await svc.runAudit({
      propertyId: 'prop-1',
      businessDate: '2026-04-06',
      mode: 'unattended',
    });
    expect(db.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ departureDate: '2026-04-07', nights: 6 }),
    ]));
  });
});
