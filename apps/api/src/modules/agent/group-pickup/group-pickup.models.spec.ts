import { describe, it, expect } from 'vitest';
import { forecastPickup, pace } from './group-pickup.models';

describe('forecastPickup', () => {
  it('guards against a zero allotment (no divide-by-zero, holds)', () => {
    const r = forecastPickup({
      roomsAllotted: 0,
      roomsPickedUp: 0,
      daysToCutoff: 10,
      historicalPickupRate: 0.7,
    });
    expect(r.projectedFinalPickup).toBe(0);
    expect(r.projectedWash).toBe(0);
    expect(r.washRate).toBe(0);
    expect(r.recommendation).toBe('hold');
    expect(r.releaseQty).toBe(0);
  });

  it('computes wash as allotted minus projected final pickup', () => {
    const r = forecastPickup({
      roomsAllotted: 100,
      roomsPickedUp: 40,
      daysToCutoff: 30, // pace = 1
      historicalPickupRate: 0.5,
    });
    // additional = 60 * 0.5 * 1 = 30 -> final 70, wash 30
    expect(r.projectedFinalPickup).toBe(70);
    expect(r.projectedWash).toBe(30);
    expect(r.washRate).toBe(0.3);
  });

  it('final pickup never exceeds the allotment', () => {
    const r = forecastPickup({
      roomsAllotted: 10,
      roomsPickedUp: 10,
      daysToCutoff: 30,
      historicalPickupRate: 1,
    });
    expect(r.projectedFinalPickup).toBeLessThanOrEqual(10);
    expect(r.projectedWash).toBe(0);
  });

  it('is monotonic in pickup: more already picked up => less wash', () => {
    const low = forecastPickup({
      roomsAllotted: 100,
      roomsPickedUp: 20,
      daysToCutoff: 10,
      historicalPickupRate: 0.7,
    });
    const high = forecastPickup({
      roomsAllotted: 100,
      roomsPickedUp: 80,
      daysToCutoff: 10,
      historicalPickupRate: 0.7,
    });
    expect(high.projectedWash).toBeLessThan(low.projectedWash);
  });

  it('recommends release_all when wash is high (>0.4)', () => {
    const r = forecastPickup({
      roomsAllotted: 100,
      roomsPickedUp: 5,
      daysToCutoff: 1, // tiny pace -> almost no additional pickup -> huge wash
      historicalPickupRate: 0.7,
    });
    expect(r.washRate).toBeGreaterThan(0.4);
    expect(r.recommendation).toBe('release_all');
    expect(r.releaseQty).toBe(Math.floor(r.projectedWash));
  });

  it('recommends release_partial in the mid wash band (>0.2..0.4)', () => {
    const r = forecastPickup({
      roomsAllotted: 100,
      roomsPickedUp: 50,
      daysToCutoff: 15, // pace 0.5: additional = 50*0.7*0.5 = 17.5 -> final 67.5 wash 32.5
      historicalPickupRate: 0.7,
    });
    expect(r.washRate).toBeGreaterThan(0.2);
    expect(r.washRate).toBeLessThanOrEqual(0.4);
    expect(r.recommendation).toBe('release_partial');
    expect(r.releaseQty).toBe(Math.floor(r.projectedWash / 2));
  });

  it('holds when wash is low (<=0.2)', () => {
    const r = forecastPickup({
      roomsAllotted: 100,
      roomsPickedUp: 90,
      daysToCutoff: 30,
      historicalPickupRate: 0.7,
    });
    expect(r.washRate).toBeLessThanOrEqual(0.2);
    expect(r.recommendation).toBe('hold');
    expect(r.releaseQty).toBe(0);
  });

  it('pace is clamped to [0,1] and monotonic', () => {
    expect(pace(-5)).toBe(0);
    expect(pace(0)).toBe(0);
    expect(pace(15)).toBeCloseTo(0.5);
    expect(pace(30)).toBe(1);
    expect(pace(100)).toBe(1);
  });
});
