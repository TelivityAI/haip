import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReservationImportService } from './reservation-import.service';
import { ReservationService } from './reservation.service';

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

async function createService(create: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationImportService,
      { provide: ReservationService, useValue: { create } },
    ],
  }).compile();
  return module.get<ReservationImportService>(ReservationImportService);
}

describe('ReservationImportService', () => {
  it('creates all valid rows and supplies propertyId', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'res-new' });
    const svc = await createService(create);

    const result = await svc.importReservations('prop-001', { propertyId: 'prop-001', rows: [makeRow(), makeRow()] as any });

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
    const svc = await createService(create);

    const result = await svc.importReservations('prop-001', {
      propertyId: 'prop-001',
      rows: [makeRow(), makeRow(), makeRow()] as any,
    });

    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[1]).toMatchObject({ index: 1, success: false, error: 'No availability' });
  });
});
