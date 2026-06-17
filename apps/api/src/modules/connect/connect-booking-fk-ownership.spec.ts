import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConnectBookingService } from './connect-booking.service';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from '../reservation/availability.service';
import { WebhookService } from '../webhook/webhook.service';

/**
 * Cross-tenant FK ownership for ConnectBookingService.modify — flagged by the
 * security re-audit. An OTAIP agent could pass dto.roomTypeId or dto.ratePlanId
 * pointing at a foreign tenant's row, and the modify path would re-read the rate
 * plan by bare id and apply the changes to the reservation.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('ConnectBookingService — modify cross-tenant FK ownership', () => {
  // The modify() method has a complex pre-amble; we test ONLY that the FK guard
  // trips before the rate re-calculation and the reservation update.
  it('REJECTS when dto.roomTypeId belongs to another property', async () => {
    // Sequence of selects modify() performs leading up to the FK check:
    //   1) findByConfirmation → booking
    //   2) reservation lookup → reservation
    //   3) my new roomTypes FK check → empty
    let i = 0;
    const seq: any[][] = [
      [{ id: 'b-1', propertyId: A, confirmationNumber: 'HAIP-1' }],
      [{ id: 'r-1', bookingId: 'b-1', roomTypeId: 'rt-1', ratePlanId: 'rp-1', arrivalDate: '2026-07-01', departureDate: '2026-07-03', totalAmount: '100.00' }],
      [],
    ];
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => Promise.resolve(seq[i++] ?? [])),
        }),
      }),
      update: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ConnectBookingService,
        { provide: DRIZZLE, useValue: db },
        { provide: AvailabilityService, useValue: { searchAvailability: vi.fn().mockResolvedValue([]) } },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
      ],
    }).compile();
    const svc = mod.get(ConnectBookingService);

    await expect(
      svc.modify('HAIP-1', { roomTypeId: 'foreign-rt' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });
});
