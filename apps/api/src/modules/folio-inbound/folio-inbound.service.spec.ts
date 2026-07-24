import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { FolioInboundService } from './folio-inbound.service';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';

function selectQueue(...results: any[][]) {
  const where = vi.fn();
  for (const result of results) {
    where.mockResolvedValueOnce(result);
  }
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where,
      })),
    })),
    where,
  };
}

describe('FolioInboundService', () => {
  let folioService: { postCharge: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    folioService = {
      postCharge: vi.fn().mockResolvedValue({ id: 'charge-1', propertyId: PROPERTY_ID }),
    };
  });

  it('posts the charge to the main guest folio for the in-house room reservation', async () => {
    const select = selectQueue([{ id: 'room-1' }], [{ id: 'res-1' }], [{ id: 'folio-1' }]);
    const tx = {
      ...select,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'ledger-1' }]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ chargeId: 'charge-1' }]),
        })),
      })),
    };
    const db = { transaction: vi.fn(async (cb: any) => cb(tx)) };
    const service = new FolioInboundService(db as any, folioService as any);

    const result = await service.postCharge(PROPERTY_ID, {
      roomNumber: '1204',
      type: 'minibar',
      amount: '18.50',
      currencyCode: 'USD',
      vendorTxnId: 'minibar-42',
      description: 'Mini bar posting',
      serviceDate: '2026-07-23',
    });

    expect(result.id).toBe('charge-1');
    expect(folioService.postCharge).toHaveBeenCalledOnce();
    const [folioId, chargeDto] = folioService.postCharge.mock.calls[0];
    expect(folioId).toBe('folio-1');
    expect(chargeDto).toMatchObject({
      propertyId: PROPERTY_ID,
      type: 'minibar',
      amount: '18.50',
      currencyCode: 'USD',
    });
  });

  it('returns the existing charge when vendorTxnId is a duplicate', async () => {
    const select = selectQueue([{ chargeId: 'charge-existing' }], [{ id: 'charge-existing' }]);
    const tx = {
      ...select,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi
            .fn()
            .mockRejectedValue({ code: '23505', constraint: 'folio_inbound_posts_property_vendor_unique' }),
        })),
      })),
      update: vi.fn(),
    };
    const db = { transaction: vi.fn(async (cb: any) => cb(tx)) };
    const service = new FolioInboundService(db as any, folioService as any);

    const result = await service.postCharge(PROPERTY_ID, {
      roomNumber: '1204',
      type: 'phone',
      amount: '12.00',
      currencyCode: 'USD',
      vendorTxnId: 'pbx-1',
    });

    expect(result).toMatchObject({ id: 'charge-existing' });
    expect(folioService.postCharge).not.toHaveBeenCalled();
  });

  it('rejects inbound posting when the room is vacant', async () => {
    const select = selectQueue([{ id: 'room-1' }], []);
    const tx = {
      ...select,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'ledger-1' }]),
        })),
      })),
      update: vi.fn(),
    };
    const db = { transaction: vi.fn(async (cb: any) => cb(tx)) };
    const service = new FolioInboundService(db as any, folioService as any);

    await expect(
      service.postCharge(PROPERTY_ID, {
        roomNumber: '1204',
        type: 'phone',
        amount: '12.00',
        currencyCode: 'USD',
        vendorTxnId: 'pbx-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
