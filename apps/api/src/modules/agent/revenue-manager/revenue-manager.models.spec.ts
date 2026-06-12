import { describe, it, expect } from 'vitest';
import {
  classifyDemand,
  revpar,
  goppar,
  requiredOccupancyForNetRevenue,
  evaluateGroupDisplacement,
  deriveDateStance,
  synthesizeStrategy,
  type ForecastInput,
} from './revenue-manager.models';

describe('classifyDemand', () => {
  it('maps occupancy into the four demand bands', () => {
    expect(classifyDemand(0.95)).toBe('peak');
    expect(classifyDemand(0.8)).toBe('high');
    expect(classifyDemand(0.55)).toBe('moderate');
    expect(classifyDemand(0.2)).toBe('low');
  });

  it('uses strict lower bounds at the band edges', () => {
    expect(classifyDemand(0.85)).toBe('high'); // not > 0.85
    expect(classifyDemand(0.7)).toBe('moderate');
    expect(classifyDemand(0.4)).toBe('low');
  });
});

describe('revpar / goppar', () => {
  it('RevPAR = ADR x occupancy', () => {
    expect(revpar(200, 0.75)).toBe(150);
  });

  it('GOPPAR = (ADR - VC1) x occupancy - FCPAR', () => {
    // (200 - 25) * 0.8 - 60 = 140 - 60 = 80
    expect(goppar(200, 25, 0.8, 60)).toBe(80);
  });

  it('GOPPAR can go negative when fixed cost is not covered', () => {
    expect(goppar(100, 25, 0.3, 60)).toBeLessThan(0);
  });
});

describe('requiredOccupancyForNetRevenue (identical-net-revenue rule)', () => {
  it('reproduces the worked example (138→115, VC 18, 72% → ~89%)', () => {
    const occ = requiredOccupancyForNetRevenue({
      currentRate: 138,
      newRate: 115,
      variableCost: 18,
      currentOccupancy: 0.72,
    });
    expect(occ).not.toBeNull();
    expect(occ!).toBeCloseTo(0.8907, 3);
  });

  it('a rate increase needs LESS occupancy to hold net revenue', () => {
    const occ = requiredOccupancyForNetRevenue({
      currentRate: 138,
      newRate: 143,
      variableCost: 18,
      currentOccupancy: 0.72,
    });
    expect(occ!).toBeLessThan(0.72);
  });

  it('returns null when the new rate does not cover variable cost', () => {
    const occ = requiredOccupancyForNetRevenue({
      currentRate: 100,
      newRate: 20,
      variableCost: 25,
      currentOccupancy: 0.7,
    });
    expect(occ).toBeNull();
  });
});

describe('evaluateGroupDisplacement', () => {
  it('accepts when total group contribution clears displaced transient contribution', () => {
    const r = evaluateGroupDisplacement({
      groupRoomNights: 235,
      groupNetRoomRate: 43.45,
      groupAncillaryContribution: 3021, // F&B + other
      displacedRoomNights: 90,
      displacedTransientNetRate: 115.06,
      displacedAncillaryContribution: 1994,
    });
    expect(r.accept).toBe(true);
    expect(r.netBenefit).toBeGreaterThan(0);
  });

  it('rejects when displacement on constrained dates outweighs group value', () => {
    const r = evaluateGroupDisplacement({
      groupRoomNights: 50,
      groupNetRoomRate: 40,
      groupAncillaryContribution: 0,
      displacedRoomNights: 50,
      displacedTransientNetRate: 120,
      displacedAncillaryContribution: 0,
    });
    expect(r.accept).toBe(false);
    expect(r.netBenefit).toBeLessThan(0);
  });
});

describe('deriveDateStance', () => {
  it('peak: raises, applies MinLOS, zero overbooking, closes low classes', () => {
    const s = deriveDateStance({ date: '2026-07-04', predictedOccupancy: 0.93 });
    expect(s.demandLevel).toBe('peak');
    expect(s.priceDirection).toBe('raise');
    expect(s.losControl).toBe('min_los');
    expect(s.overbooking).toBe('zero');
    expect(s.closeLowRateClasses).toBe(true);
    expect(s.fences).toContain('prepayment');
  });

  it('low: lowers with fenced discount and aggressive overbooking', () => {
    const s = deriveDateStance({ date: '2026-02-03', predictedOccupancy: 0.25 });
    expect(s.demandLevel).toBe('low');
    expect(s.priceDirection).toBe('lower');
    expect(s.overbooking).toBe('aggressive');
    expect(s.fences).toContain('non_refundable');
    expect(s.rationale).toContain('fenced_last_minute_discount');
  });

  it('moderate demand holds price', () => {
    const s = deriveDateStance({ date: '2026-03-03', predictedOccupancy: 0.55 });
    expect(s.priceDirection).toBe('hold');
  });

  it('never lets a raw discount fire on strong demand (rate-grid integrity)', () => {
    const s = deriveDateStance({
      date: '2026-07-04',
      predictedOccupancy: 0.93,
      pricingAdjustmentPct: -20, // a bad downstream suggestion
    });
    expect(s.priceDirection).toBe('raise');
    expect(s.priceAdjustmentPct).toBeGreaterThan(0);
    expect(s.rationale).toContain('override_discount_on_strong_demand');
  });

  it('pace below prior year softens a raise toward hold', () => {
    const s = deriveDateStance({
      date: '2026-05-05',
      predictedOccupancy: 0.8, // high
      pace: { ratio: 0.7 },
    });
    expect(s.rationale).toContain('pace_below_prior_year_open_lower');
    expect(s.priceDirection).toBe('hold');
  });

  it('strong pace pushes a hold up to a raise', () => {
    const s = deriveDateStance({
      date: '2026-05-06',
      predictedOccupancy: 0.55, // moderate → hold
      pace: { ratio: 1.3 },
    });
    expect(s.priceDirection).toBe('raise');
    expect(s.rationale).toContain('pace_above_prior_year_raise');
  });
});

describe('synthesizeStrategy', () => {
  const forecasts: ForecastInput[] = [
    { date: '2026-07-03', predictedOccupancy: 0.92, confidence: 0.8 },
    { date: '2026-07-04', predictedOccupancy: 0.95, confidence: 0.8 },
    { date: '2026-07-10', predictedOccupancy: 0.3, confidence: 0.7 },
    { date: '2026-07-11', predictedOccupancy: 0.55, confidence: 0.7 },
  ];

  it('produces one stance per forecast date and a summary', () => {
    const strat = synthesizeStrategy({
      objective: 'goppar',
      variableCostPerRoom: 25,
      fcpar: 60,
      baselineAdr: 200,
      forecasts,
    });
    expect(strat.perDate).toHaveLength(4);
    expect(strat.horizonDays).toBe(4);
    expect(strat.summary.peakDates).toEqual(['2026-07-03', '2026-07-04']);
    expect(strat.summary.lowDates).toEqual(['2026-07-10']);
    expect(strat.summary.minLosDates).toBe(2);
    expect(strat.objective).toBe('goppar');
  });

  it('projects RevPAR and GOPPAR and enforces guardrails', () => {
    const strat = synthesizeStrategy({
      objective: 'goppar',
      variableCostPerRoom: 25,
      fcpar: 60,
      baselineAdr: 200,
      forecasts,
    });
    expect(strat.summary.projectedRevPAR).toBeGreaterThan(0);
    expect(typeof strat.summary.projectedGOPPAR).toBe('number');
    expect(strat.summary.guardrails).toContain('discounting_is_last_resort');
    expect(strat.summary.guardrails).toContain('optimize_goppar_not_revenue_alone');
  });

  it('honors per-date pricing adjustments when consistent with demand', () => {
    const strat = synthesizeStrategy({
      objective: 'goppar',
      variableCostPerRoom: 25,
      fcpar: 60,
      baselineAdr: 200,
      forecasts,
      pricingByDate: { '2026-07-11': 8 }, // moderate date, clamped to hold band
    });
    const d = strat.perDate.find((x) => x.date === '2026-07-11')!;
    expect(d.priceDirection).toBe('hold');
    expect(Math.abs(d.priceAdjustmentPct)).toBeLessThanOrEqual(2);
  });

  it('returns an empty-safe strategy for no forecasts', () => {
    const strat = synthesizeStrategy({
      objective: 'revpar',
      variableCostPerRoom: 25,
      fcpar: 60,
      baselineAdr: 200,
      forecasts: [],
    });
    expect(strat.perDate).toHaveLength(0);
    expect(strat.summary.avgOccupancy).toBe(0);
  });
});
