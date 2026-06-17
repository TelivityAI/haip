import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FolioService } from './folio.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { TaxService } from '../tax/tax.service';

const A = 'aaaaaaaa-0000-4000-a000-000000000001';

/** db whose first select (findById) returns an open folio. */
function mkDb() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'f-1', propertyId: A, status: 'open' }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'c-1' }]) }),
    }),
    // recalculateBalance() runs after a successful post.
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

async function mkSvc(db: any) {
  const mod = await Test.createTestingModule({
    providers: [
      FolioService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: TaxService, useValue: { calculateTaxes: vi.fn().mockResolvedValue([]) } },
    ],
  }).compile();
  return mod.get(FolioService);
}

const baseCharge = {
  propertyId: A,
  description: 'x',
  currencyCode: 'USD',
  serviceDate: '2026-07-01',
};

describe('FolioService.postCharge — amount sign rules', () => {
  it('rejects a negative amount on a normal (non-adjustment, non-reversal) charge', async () => {
    const svc = await mkSvc(mkDb());
    await expect(
      svc.postCharge('f-1', { ...baseCharge, type: 'room', amount: '-50.00' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a zero amount on a normal charge', async () => {
    const svc = await mkSvc(mkDb());
    await expect(
      svc.postCharge('f-1', { ...baseCharge, type: 'minibar', amount: '0' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ALLOWS a negative amount when type=adjustment (legitimate credit)', async () => {
    const db = mkDb();
    const svc = await mkSvc(db);
    await svc.postCharge('f-1', { ...baseCharge, type: 'adjustment', amount: '-50.00' } as any);
    expect(db.insert).toHaveBeenCalled();
  });

  it('ALLOWS a positive normal charge', async () => {
    const db = mkDb();
    const svc = await mkSvc(db);
    await svc.postCharge('f-1', { ...baseCharge, type: 'room', amount: '150.00' } as any);
    expect(db.insert).toHaveBeenCalled();
  });
});
