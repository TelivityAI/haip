import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WaitlistService } from './waitlist.service';

describe('WaitlistService', () => {
  let availabilityService: { searchAvailability: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    availabilityService = {
      searchAvailability: vi.fn().mockResolvedValue([{ available: 1 }]),
    };
  });

  it('creates a non-deducting active waitlist entry', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'wl-1', propertyId: 'prop-1', status: 'active' }]),
        })),
      })),
    };
    const service = new WaitlistService(db as any, availabilityService as any);

    const result = await service.create({
      propertyId: 'prop-1',
      arrivalDate: '2026-09-01',
      departureDate: '2026-09-03',
      guestName: 'Alex Guest',
    });

    expect(result.status).toBe('active');
    const values = db.insert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(values?.propertyId).toBe('prop-1');
    expect(values?.status).toBe('active');
  });

  it('cancels an active waitlist entry without touching inventory', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            {
              id: 'wl-1',
              propertyId: 'prop-1',
              status: 'active',
              arrivalDate: '2026-09-01',
              departureDate: '2026-09-03',
            },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'wl-1', status: 'cancelled' }]),
          })),
        })),
      })),
    };
    const service = new WaitlistService(db as any, availabilityService as any);

    const result = await service.cancel('wl-1', 'prop-1');

    expect(result.status).toBe('cancelled');
    expect(availabilityService.searchAvailability).not.toHaveBeenCalled();
  });
});
