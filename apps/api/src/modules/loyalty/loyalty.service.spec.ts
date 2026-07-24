import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoyaltyService } from './loyalty.service';

describe('LoyaltyService', () => {
  let db: { transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = {
      transaction: vi.fn(),
    };
  });

  it('earns pending points based on nights * pointsPerNight', async () => {
    const tx = {
      select: vi
        .fn()
        .mockImplementationOnce(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([
              { id: 'program-1', organizationId: 'org-1', pointsPerNight: 100, delayDays: 3, earnEnabled: true },
            ]),
          })),
        }))
        .mockImplementationOnce(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([
              { id: 'account-1', organizationId: 'org-1', guestId: 'guest-1', pendingPoints: 50, availablePoints: 0 },
            ]),
          })),
        })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { id: 'account-1', pendingPoints: 250, availablePoints: 0 },
            ]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'ltx-1', type: 'earn', points: 200 }]),
        })),
      })),
    };
    db.transaction.mockImplementation(async (cb: any) => cb(tx));
    const service = new LoyaltyService(db as any);

    const result = await service.earn({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      guestId: 'guest-1',
      nights: 2,
      reservationId: 'res-1',
    });

    expect(result.account.pendingPoints).toBe(250);
    expect(result.transaction.points).toBe(200);
  });

  it('burns from the available balance and records the burn transaction', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { id: 'account-1', organizationId: 'org-1', guestId: 'guest-1', pendingPoints: 0, availablePoints: 500 },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { id: 'account-1', pendingPoints: 0, availablePoints: 350 },
            ]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'ltx-2', type: 'burn', points: 150 }]),
        })),
      })),
    };
    db.transaction.mockImplementation(async (cb: any) => cb(tx));
    const service = new LoyaltyService(db as any);

    const result = await service.burn({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      guestId: 'guest-1',
      points: 150,
      folioId: 'folio-1',
    });

    expect(result.account.availablePoints).toBe(350);
    expect(result.transaction.type).toBe('burn');
  });
});
