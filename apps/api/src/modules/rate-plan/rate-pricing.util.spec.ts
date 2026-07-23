import { describe, it, expect } from 'vitest';
import {
  applyRateAdjustment,
  nightsBetween,
  selectLosAdjustment,
  selectOccupancyBand,
} from './rate-pricing.util';

describe('rate-pricing.util', () => {
  const losTiers = [
    { minNights: 7, adjustmentType: 'percentage' as const, adjustmentValue: -5 },
    { minNights: 14, adjustmentType: 'percentage' as const, adjustmentValue: -10 },
    { minNights: 21, adjustmentType: 'percentage' as const, adjustmentValue: -15 },
  ];

  it('selects the highest qualifying LOS tier', () => {
    expect(selectLosAdjustment(losTiers, 6)).toBeNull();
    expect(selectLosAdjustment(losTiers, 7)?.adjustmentValue).toBe(-5);
    expect(selectLosAdjustment(losTiers, 13)?.adjustmentValue).toBe(-5);
    expect(selectLosAdjustment(losTiers, 14)?.adjustmentValue).toBe(-10);
    expect(selectLosAdjustment(losTiers, 21)?.adjustmentValue).toBe(-15);
    expect(selectLosAdjustment(losTiers, 30)?.adjustmentValue).toBe(-15);
  });

  it('selects occupancy band by percentage range', () => {
    const bands = [
      { occupancyPctMin: 0, occupancyPctMax: 50, adjustmentType: 'percentage' as const, adjustmentValue: -10 },
      { occupancyPctMin: 51, occupancyPctMax: 80, adjustmentType: 'percentage' as const, adjustmentValue: 0 },
      { occupancyPctMin: 81, occupancyPctMax: 100, adjustmentType: 'percentage' as const, adjustmentValue: 15 },
    ];
    expect(selectOccupancyBand(bands, 40)?.adjustmentValue).toBe(-10);
    expect(selectOccupancyBand(bands, 65)?.adjustmentValue).toBe(0);
    expect(selectOccupancyBand(bands, 90)?.adjustmentValue).toBe(15);
    expect(selectOccupancyBand(bands, 101)).toBeNull();
  });

  it('applies percentage and fixed adjustments', () => {
    expect(applyRateAdjustment(200, { adjustmentType: 'percentage', adjustmentValue: -10 })).toBe(180);
    expect(applyRateAdjustment(200, { adjustmentType: 'fixed', adjustmentValue: -25 })).toBe(175);
    expect(applyRateAdjustment(200, { adjustmentType: 'percentage', adjustmentValue: 12 })).toBeCloseTo(224);
  });

  it('computes nights between dates', () => {
    expect(nightsBetween('2026-08-01', '2026-08-08')).toBe(7);
    expect(nightsBetween('2026-08-01', '2026-08-02')).toBe(1);
  });
});
