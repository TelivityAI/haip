import { describe, it, expect } from 'vitest';
import { decisionNumberSet, significantNumbers, isSupported, groundExplanation } from './grounding';

describe('grounding — anti-hallucination guard', () => {
  it('collects numbers recursively from the decision (numbers + numeric strings)', () => {
    const set = decisionNumberSet({
      occupancy: 0.87,
      confidence: '0.80',
      tiers: [{ adj: 12 }, { adj: 25 }],
      label: 'peak',
    });
    expect(set.has(0.87)).toBe(true);
    expect(set.has(0.8)).toBe(true);
    expect(set.has(12)).toBe(true);
    expect(set.has(25)).toBe(true);
  });

  it('extracts significant figures ($, %, ≥25) but ignores small action integers', () => {
    const nums = significantNumbers('Raise to $450, that is +12% on a min-LOS of 2, occupancy 87%');
    expect(nums).toContain(450);
    expect(nums).toContain(12);
    expect(nums).toContain(87);
    expect(nums).not.toContain(2); // small action integer, allowed
  });

  it('supports a figure via its percent (×100) form', () => {
    const set = new Set([0.87, 12]);
    expect(isSupported(87, set)).toBe(true); // 0.87 × 100
    expect(isSupported(12, set)).toBe(true);
    expect(isSupported(450, set)).toBe(false);
  });

  it('keeps grounded suggestions and a grounded rationale', () => {
    const out = groundExplanation(
      { occupancy: 0.87, recommendedAdjustmentPct: 12 },
      {
        rationale: 'Peak demand at 87% occupancy supports a 12% raise.',
        suggestions: ['Set min-LOS 2 on the peak nights'],
      },
    );
    expect(out.grounded).toBe(true);
    expect(out.suggestions).toEqual(['Set min-LOS 2 on the peak nights']);
  });

  it('drops a suggestion that invents an unsupported price', () => {
    const out = groundExplanation(
      { occupancy: 0.87, recommendedAdjustmentPct: 12 },
      {
        rationale: 'Occupancy is high.',
        suggestions: ['Raise the rate to $450 tonight', 'Set min-LOS 2'],
      },
    );
    expect(out.suggestions).toEqual(['Set min-LOS 2']); // the $450 one is removed
    expect(out.grounded).toBe(true); // rationale itself had no invented figure
  });

  it('flags the rationale as not grounded when it asserts an invented figure', () => {
    const out = groundExplanation(
      { occupancy: 0.87, recommendedAdjustmentPct: 12 },
      { rationale: 'I recommend setting the rate to $999.', suggestions: [] },
    );
    expect(out.grounded).toBe(false);
  });
});
