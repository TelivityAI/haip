import { describe, expect, it, vi } from 'vitest';
import { PropertyService } from './property.service';

/**
 * `settings` is a bag of independent feature flags. A PATCH that replaces it wholesale
 * silently deletes every key the caller did not resend, so the merge is the contract.
 */
function createDb(existing: Record<string, unknown>) {
  const setSpy = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ ...existing }]),
    }),
  });
  const insertValues = vi.fn().mockResolvedValue(undefined);
  return {
    setSpy,
    insertValues,
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...existing }]),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: setSpy }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    },
  };
}

describe('PropertyService.update', () => {
  it('merges settings instead of replacing them', async () => {
    const existing = {
      id: 'prop-1',
      settings: { kpiThresholds: { adr: 120 }, depositPercentage: 20 },
      staffLogoMediaId: null,
    };
    const { db, setSpy } = createDb(existing);
    const service = new PropertyService(db as any);

    await service.update('prop-1', { checkInTime: '15:00', settings: { lateCheckoutFee: 50 } } as any);

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        checkInTime: '15:00',
        settings: {
          kpiThresholds: { adr: 120 },
          depositPercentage: 20,
          lateCheckoutFee: 50,
        },
      }),
    );
  });

  it('leaves settings untouched when the patch does not mention them', async () => {
    const existing = {
      id: 'prop-1',
      settings: { depositPercentage: 20 },
      staffLogoMediaId: null,
    };
    const { db, setSpy } = createDb(existing);
    const service = new PropertyService(db as any);

    await service.update('prop-1', { checkOutTime: '11:00' } as any);

    const patch = setSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch['settings']).toBeUndefined();
    expect(patch['checkOutTime']).toBe('11:00');
  });

  it('writes a property audit row with the previous and new settings', async () => {
    const existing = {
      id: 'prop-1',
      settings: { depositPercentage: 20 },
      staffLogoMediaId: null,
    };
    const { db, insertValues } = createDb(existing);
    const service = new PropertyService(db as any);

    await service.update(
      'prop-1',
      { settings: { depositPercentage: 30 } } as any,
      { userId: 'user-1', userEmail: 'gm@example.com', ipAddress: '10.0.0.1' },
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'prop-1',
        action: 'update',
        entityType: 'property',
        entityId: 'prop-1',
        userEmail: 'gm@example.com',
        previousValue: { settings: { depositPercentage: 20 } },
        newValue: expect.objectContaining({ settings: { depositPercentage: 30 } }),
      }),
    );
  });
});
