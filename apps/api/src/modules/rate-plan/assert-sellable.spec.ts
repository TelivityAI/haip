import { describe, it, expect } from 'vitest';
import { RatePlanService } from './rate-plan.service';

const PROPERTY = '11111111-1111-1111-1111-111111111111';
const RATE_PLAN = '22222222-2222-2222-2222-222222222222';
const CHECK_IN = '2026-07-10';
const CHECK_OUT = '2026-07-12'; // 2 nights

/** db whose select().from().where() resolves to the given restriction rows. */
function svcWith(restrictions: any[]): RatePlanService {
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(restrictions) }) }),
  };
  return new RatePlanService(db as any);
}

const span = { startDate: '2026-07-01', endDate: '2026-07-31' };

describe('RatePlanService.assertSellable', () => {
  it('passes when there are no restrictions', async () => {
    await expect(svcWith([]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT)).resolves.toBeUndefined();
  });

  it('rejects check-out not after check-in', async () => {
    await expect(svcWith([]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_IN)).rejects.toThrow(
      /Check-out must be after check-in/,
    );
  });

  it('rejects a stop-sell (closed) rate', async () => {
    await expect(
      svcWith([{ ...span, isClosed: true }]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT),
    ).rejects.toThrow(/closed \(stop-sell\)/);
  });

  it('rejects closed-to-arrival on the check-in date', async () => {
    await expect(
      svcWith([{ ...span, closedToArrival: true }]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT),
    ).rejects.toThrow(/closed to arrival/);
  });

  it('rejects closed-to-departure on the check-out date', async () => {
    await expect(
      svcWith([{ ...span, closedToDeparture: true }]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT),
    ).rejects.toThrow(/closed to departure/);
  });

  it('rejects a stay shorter than min-LOS', async () => {
    await expect(
      svcWith([{ ...span, minLos: 3 }]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT),
    ).rejects.toThrow(/Minimum length of stay is 3/);
  });

  it('rejects a stay longer than max-LOS', async () => {
    await expect(
      svcWith([{ ...span, maxLos: 1 }]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT),
    ).rejects.toThrow(/Maximum length of stay is 1/);
  });

  it('passes when restrictions exist but none are violated', async () => {
    await expect(
      svcWith([
        { ...span, minLos: 1, maxLos: 5, closedToArrival: false, closedToDeparture: false, isClosed: false },
      ]).assertSellable(PROPERTY, RATE_PLAN, CHECK_IN, CHECK_OUT),
    ).resolves.toBeUndefined();
  });

  it('does not treat CTA outside the arrival date as a block', async () => {
    // restriction window is entirely after the stay → covers() is false for check-in
    await expect(
      svcWith([{ startDate: '2026-08-01', endDate: '2026-08-31', closedToArrival: true }]).assertSellable(
        PROPERTY,
        RATE_PLAN,
        CHECK_IN,
        CHECK_OUT,
      ),
    ).resolves.toBeUndefined();
  });
});
