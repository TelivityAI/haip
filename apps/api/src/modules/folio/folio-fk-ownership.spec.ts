import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FolioService } from './folio.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { TaxService } from '../tax/tax.service';

/**
 * Cross-tenant FK ownership for FolioService.create (follow-on to audit #4-6,
 * flagged by Codex re-audit as the same anti-pattern on `reservationId` and
 * `bookingId`).
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

function mkDbSeq(rows: any[][]) {
  let i = 0;
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(rows[i++] ?? [])),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'f-1' }]) }),
    }),
  };
}

async function mkSvc(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      FolioService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: TaxService, useValue: {} },
    ],
  }).compile();
  return mod.get(FolioService);
}

describe('FolioService — cross-tenant FK ownership', () => {
  it('rejects when dto.reservationId belongs to another property', async () => {
    const db = mkDbSeq([
      [], // reservation FK check empty → foreign
    ]);
    const svc = await mkSvc(db);
    await expect(
      svc.create({ propertyId: A, reservationId: 'foreign-r', guestId: 'g', type: 'guest' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects when dto.bookingId belongs to another property (reservation OK)', async () => {
    const db = mkDbSeq([
      [{ id: 'r-1' }], // reservation FK OK
      [],              // booking FK empty → foreign
    ]);
    const svc = await mkSvc(db);
    await expect(
      svc.create({ propertyId: A, reservationId: 'r-1', bookingId: 'foreign-b', guestId: 'g', type: 'guest' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
