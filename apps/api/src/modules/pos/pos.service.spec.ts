import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PosService } from './pos.service';
import type { PostPosChargeDto } from './dto/post-pos-charge.dto';

const PROPERTY_ID = '22222222-2222-2222-2222-222222222222';
const FOLIO_ID = '33333333-3333-3333-3333-333333333333';

describe('PosService', () => {
  let folioService: { postCharge: ReturnType<typeof vi.fn> };
  let service: PosService;

  beforeEach(() => {
    folioService = { postCharge: vi.fn().mockResolvedValue({ id: 'charge-1' }) };
    service = new PosService(folioService as any);
  });

  const baseDto = (): PostPosChargeDto => ({
    folioId: FOLIO_ID,
    type: 'food_beverage',
    description: 'Dinner',
    amount: '84.50',
    currencyCode: 'USD',
    serviceDate: '2026-06-17',
  });

  it('posts the charge to the folio scoped to the pinned propertyId', async () => {
    await service.postCharge(PROPERTY_ID, baseDto());

    expect(folioService.postCharge).toHaveBeenCalledOnce();
    const [folioId, charge] = folioService.postCharge.mock.calls[0];
    expect(folioId).toBe(FOLIO_ID);
    expect(charge).toMatchObject({
      propertyId: PROPERTY_ID,
      type: 'food_beverage',
      amount: '84.50',
      currencyCode: 'USD',
    });
  });

  it('appends the external POS reference to the description for traceability', async () => {
    await service.postCharge(PROPERTY_ID, { ...baseDto(), reference: '4821' });

    const [, charge] = folioService.postCharge.mock.calls[0];
    expect(charge.description).toContain('POS ref 4821');
  });

  it('always pins the propertyId passed by the controller, not anything in the DTO', async () => {
    // Even if a (platform) caller smuggled a different propertyId into the DTO,
    // the service uses ONLY the propertyId argument the controller resolved.
    await service.postCharge(PROPERTY_ID, { ...baseDto(), propertyId: 'attacker-tenant' } as any);

    const [, charge] = folioService.postCharge.mock.calls[0];
    expect(charge.propertyId).toBe(PROPERTY_ID);
  });
});
