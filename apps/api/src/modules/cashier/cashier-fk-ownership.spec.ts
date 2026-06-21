import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CashierService } from './cashier.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';

/**
 * Cross-tenant FK ownership for CashierService.recordMovement — flagged by the
 * security re-audit. A cashier could pass a foreign-property reservationId and
 * attribute the cash movement (and downstream reporting) to that tenant.
 */
const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('CashierService — recordMovement cross-tenant FK ownership', () => {
  it('rejects when dto.reservationId belongs to another property', async () => {
    // findSessionById first (returns open session), then reservations FK check (empty).
    let i = 0;
    const seq: any[][] = [
      [{ id: 's-1', propertyId: A, status: 'open' }], // findSessionById
      [],                                              // reservations FK empty
    ];
    const db: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => Promise.resolve(seq[i++] ?? [])),
        }),
      }),
      insert: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CashierService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
      ],
    }).compile();
    const svc = mod.get(CashierService);

    await expect(
      svc.recordMovement('s-1', {
        propertyId: A,
        reservationId: 'foreign-r',
        type: 'payment',
        amount: '50.00',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
