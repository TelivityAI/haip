import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReservationImportService } from './reservation-import.service';
import { ReservationService } from './reservation.service';
import { MigrationLegacyIdMapService } from '../migration/migration-legacy-id-map.service';
import { DRIZZLE } from '../../database/database.module';

const makeRow = (overrides: any = {}) => ({
  guestId: 'guest-001',
  arrivalDate: '2026-06-01',
  departureDate: '2026-06-05',
  roomTypeId: 'rt-001',
  ratePlanId: 'rp-001',
  totalAmount: '500.00',
  currencyCode: 'USD',
  source: 'direct',
  ...overrides,
});

async function createService(deps: {
  create?: any;
  lookup?: any;
  record?: any;
  bookings?: any[];
  reservations?: any[];
}) {
  const module = await Test.createTestingModule({
    providers: [
      ReservationImportService,
      { provide: ReservationService, useValue: { create: deps.create ?? vi.fn() } },
      {
        provide: MigrationLegacyIdMapService,
        useValue: {
          lookup: deps.lookup ?? vi.fn().mockResolvedValue(null),
          record: deps.record ?? vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: DRIZZLE,
        useValue: {
          select: vi.fn(() => ({
            from: vi.fn((table: any) => ({
              where: vi.fn(() => {
                const name = String(table?.[Symbol.for('drizzle:Name')] ?? '');
                if (name.includes('bookings')) {
                  return Promise.resolve(deps.bookings ?? []);
                }
                return Promise.resolve(deps.reservations ?? []);
              }),
            })),
          })),
        },
      },
    ],
  }).compile();
  return module.get<ReservationImportService>(ReservationImportService);
}

describe('ReservationImportService', () => {
  it('creates all valid rows and supplies propertyId', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'res-new' });
    const svc = await createService({ create });

    const result = await svc.importReservations('prop-001', {
      propertyId: 'prop-001',
      rows: [makeRow(), makeRow()] as any,
    });

    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'prop-001' }));
  });

  it('flags invalid rows without aborting the batch', async () => {
    let n = 0;
    const create = vi.fn().mockImplementation(() => {
      n++;
      if (n === 2) throw new BadRequestException('No availability');
      return Promise.resolve({ id: `res-${n}` });
    });
    const svc = await createService({ create });

    const result = await svc.importReservations('prop-001', {
      propertyId: 'prop-001',
      rows: [makeRow(), makeRow(), makeRow()] as any,
    });

    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[1]).toMatchObject({ index: 1, success: false, error: 'No availability' });
  });

  it('dry run validates without creating reservations', async () => {
    const create = vi.fn();
    const svc = await createService({ create });

    const result = await svc.importReservations('prop-001', {
      propertyId: 'prop-001',
      dryRun: true,
      rows: [makeRow()] as any,
    });

    expect(result.created).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('resolves legacy guest/room-type/rate-plan ids via the id map', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'res-new' });
    const lookup = vi.fn(async (_p, _proj, entity: string) => {
      if (entity === 'guests') return 'guest-mapped';
      if (entity === 'room-types') return 'rt-mapped';
      if (entity === 'rate-plans') return 'rp-mapped';
      return null;
    });
    const svc = await createService({ create, lookup });

    await svc.importReservations('prop-001', {
      propertyId: 'prop-001',
      projectId: 'proj-1',
      rows: [
        makeRow({
          guestId: undefined,
          roomTypeId: undefined,
          ratePlanId: undefined,
          legacyGuestId: 'LEG-G',
          legacyRoomTypeId: 'LEG-RT',
          legacyRatePlanId: 'LEG-RP',
        }),
      ] as any,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        guestId: 'guest-mapped',
        roomTypeId: 'rt-mapped',
        ratePlanId: 'rp-mapped',
      }),
    );
  });

  it('dedupes by project + entity + legacy_id without double-creating', async () => {
    const create = vi.fn();
    const lookup = vi.fn().mockResolvedValue('existing-res');
    const svc = await createService({ create, lookup });

    const result = await svc.importReservations('prop-001', {
      propertyId: 'prop-001',
      projectId: 'proj-1',
      rows: [makeRow({ legacyId: 'LEG-RES-1' })] as any,
    });

    expect(result.skipped).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      success: true,
      skipped: true,
      reservationId: 'existing-res',
    });
  });
});
