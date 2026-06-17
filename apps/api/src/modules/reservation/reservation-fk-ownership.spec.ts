import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReservationService } from './reservation.service';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from './availability.service';
import { FolioService } from '../folio/folio.service';
import { RoomStatusService } from '../room/room-status.service';
import { PaymentService } from '../payment/payment.service';
import { WebhookService } from '../webhook/webhook.service';

/**
 * Cross-tenant FK ownership tests for ReservationService (security audit #4).
 *
 * Before the fix: dto.roomTypeId / dto.ratePlanId from the caller were inserted
 * blindly. A caller at property A could reference property B's rate plan and
 * leak its details back through the read join. Now the service verifies each FK
 * belongs to the SAME propertyId as the request before any insert/update.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

/**
 * Sequenced-select mock. `create()` runs:
 *   1) guest lookup (NotFoundException if empty)
 *   2) roomTypes FK ownership check (BadRequestException if empty) ← the audit fix
 *   3) ratePlans FK ownership check (BadRequestException if empty) ← the audit fix
 * `modify()` runs:
 *   1) findByIdRaw on reservations
 *   2) roomTypes FK ownership (only if dto.roomTypeId)
 *   3) ratePlans FK ownership (only if dto.ratePlanId)
 */
function mkDbSeq(selectResults: any[][]) {
  let i = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(selectResults[i++] ?? [])),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
    }),
    update: vi.fn(),
    transaction: vi.fn().mockImplementation(async (cb: any) => cb({} as any)),
  };
}

async function mkService(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      ReservationService,
      { provide: DRIZZLE, useValue: db },
      { provide: AvailabilityService, useValue: { searchAvailability: vi.fn().mockResolvedValue([]) } },
      { provide: FolioService, useValue: {} },
      { provide: RoomStatusService, useValue: {} },
      { provide: PaymentService, useValue: {} },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
    ],
  }).compile();
  return mod.get(ReservationService);
}

describe('ReservationService — cross-tenant FK ownership (audit #4)', () => {
  it('create() rejects when dto.roomTypeId belongs to another property', async () => {
    // selects in order: guest (found), roomTypes FK check (empty = foreign).
    const db = mkDbSeq([
      [{ id: 'g', isDnr: false }],   // 1) guest lookup OK
      [],                             // 2) FK check on roomTypes → not in this property
    ]);
    const svc = await mkService(db);

    await expect(
      svc.create({
        propertyId: A,
        roomTypeId: 'foreign-room-type',
        ratePlanId: 'plan-1',
        arrivalDate: '2026-07-01',
        departureDate: '2026-07-03',
        totalAmount: '300.00',
        currencyCode: 'USD',
        guestId: 'g',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('create() rejects when dto.ratePlanId belongs to another property (roomType OK)', async () => {
    const db = mkDbSeq([
      [{ id: 'g', isDnr: false }],   // 1) guest lookup OK
      [{ id: 'rt-1' }],               // 2) FK check on roomTypes OK
      [],                             // 3) FK check on ratePlans → not in this property
    ]);
    const svc = await mkService(db);

    await expect(
      svc.create({
        propertyId: A,
        roomTypeId: 'rt-1',
        ratePlanId: 'foreign-plan',
        arrivalDate: '2026-07-01',
        departureDate: '2026-07-03',
        totalAmount: '300.00',
        currencyCode: 'USD',
        guestId: 'g',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('modify() rejects when dto.roomTypeId belongs to another property', async () => {
    const db = mkDbSeq([
      // 1) findByIdRaw → reservation in propertyId A
      [{ id: 'r-1', propertyId: A, status: 'confirmed', arrivalDate: '2026-07-01', departureDate: '2026-07-03', roomTypeId: 'rt-1' }],
      // 2) FK check on roomTypes → empty (foreign)
      [],
    ]);
    const svc = await mkService(db);
    await expect(
      svc.modify('r-1', A, { roomTypeId: 'foreign-room-type' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('modify() rejects when dto.ratePlanId belongs to another property', async () => {
    const db = mkDbSeq([
      // 1) findByIdRaw → reservation in propertyId A
      [{ id: 'r-1', propertyId: A, status: 'confirmed', arrivalDate: '2026-07-01', departureDate: '2026-07-03', roomTypeId: 'rt-1' }],
      // 2) FK check on ratePlans → empty (foreign)
      [],
    ]);
    const svc = await mkService(db);
    await expect(
      svc.modify('r-1', A, { ratePlanId: 'foreign-rate-plan' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
