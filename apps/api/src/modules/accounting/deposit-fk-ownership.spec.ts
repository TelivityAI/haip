import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DepositService } from './deposit.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';

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
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'd-1' }]) }),
    }),
  };
}

async function mkSvc(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      DepositService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: FolioService, useValue: {} },
    ],
  }).compile();
  return mod.get(DepositService);
}

describe('DepositService — cross-tenant FK ownership', () => {
  it('rejects when dto.reservationId belongs to another property', async () => {
    const db = mkDbSeq([[]]); // reservation FK empty
    const svc = await mkSvc(db);
    await expect(
      svc.recordDeposit({ propertyId: A, reservationId: 'foreign-r', amount: '100', currencyCode: 'USD' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects when dto.paymentId belongs to another property (reservation OK)', async () => {
    const db = mkDbSeq([
      [{ id: 'r-1' }], // reservation FK OK
      [],              // payment FK empty
    ]);
    const svc = await mkSvc(db);
    await expect(
      svc.recordDeposit({ propertyId: A, reservationId: 'r-1', paymentId: 'foreign-p', amount: '100', currencyCode: 'USD' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
