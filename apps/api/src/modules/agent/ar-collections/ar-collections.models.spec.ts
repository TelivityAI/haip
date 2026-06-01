import { describe, it, expect } from 'vitest';
import { scoreArLedger, rankCollections, type ArAgingInput, type ArCollectionScore } from './ar-collections.models';

const base: ArAgingInput = {
  arLedgerId: 'l1',
  ledgerName: 'Acme Corp',
  balance: 5000,
  oldestTransferAgeDays: 45,
  openTransferCount: 2,
  paymentTermsDays: 30,
};

describe('scoreArLedger', () => {
  it('higher balance yields higher priority score', () => {
    const low = scoreArLedger({ ...base, balance: 1000 });
    const high = scoreArLedger({ ...base, balance: 20000 });
    expect(high.priorityScore).toBeGreaterThan(low.priorityScore);
  });

  it('older transfers yield higher priority score', () => {
    const fresh = scoreArLedger({ ...base, oldestTransferAgeDays: 31 });
    const aged = scoreArLedger({ ...base, oldestTransferAgeDays: 120 });
    expect(aged.priorityScore).toBeGreaterThan(fresh.priorityScore);
  });

  it('more open transfers yield higher priority score', () => {
    const few = scoreArLedger({ ...base, openTransferCount: 1 });
    const many = scoreArLedger({ ...base, openTransferCount: 10 });
    expect(many.priorityScore).toBeGreaterThan(few.priorityScore);
  });

  it('clamps daysOverdue at 0 when within terms', () => {
    const result = scoreArLedger({ ...base, oldestTransferAgeDays: 10, paymentTermsDays: 30 });
    expect(result.daysOverdue).toBe(0);
  });

  it('computes daysOverdue beyond payment terms', () => {
    const result = scoreArLedger({ ...base, oldestTransferAgeDays: 50, paymentTermsDays: 30 });
    expect(result.daysOverdue).toBe(20);
  });

  it('defaults to 30-day terms when paymentTermsDays is null', () => {
    const result = scoreArLedger({ ...base, oldestTransferAgeDays: 40, paymentTermsDays: null });
    expect(result.daysOverdue).toBe(10);
  });

  it('classifies high risk and recommends final notice for large overdue ledgers', () => {
    const result = scoreArLedger({
      arLedgerId: 'l',
      ledgerName: 'Big Debtor',
      balance: 50000,
      oldestTransferAgeDays: 200,
      openTransferCount: 10,
      paymentTermsDays: 30,
    });
    expect(result.priorityScore).toBeGreaterThanOrEqual(0.66);
    expect(result.riskLevel).toBe('high');
    expect(result.recommendedAction).toBe('send_final_notice');
  });

  it('classifies low risk and recommends monitor for small current ledgers', () => {
    const result = scoreArLedger({
      arLedgerId: 'l',
      ledgerName: 'Small',
      balance: 100,
      oldestTransferAgeDays: 5,
      openTransferCount: 1,
      paymentTermsDays: 30,
    });
    expect(result.priorityScore).toBeLessThan(0.33);
    expect(result.riskLevel).toBe('low');
    expect(result.recommendedAction).toBe('monitor');
  });

  it('keeps priorityScore within [0,1]', () => {
    const result = scoreArLedger({
      arLedgerId: 'l',
      ledgerName: 'Max',
      balance: 1_000_000,
      oldestTransferAgeDays: 1000,
      openTransferCount: 100,
      paymentTermsDays: 0,
    });
    expect(result.priorityScore).toBeGreaterThanOrEqual(0);
    expect(result.priorityScore).toBeLessThanOrEqual(1);
  });
});

describe('rankCollections', () => {
  it('sorts by priorityScore descending', () => {
    const scores: ArCollectionScore[] = [
      { arLedgerId: 'a', ledgerName: 'A', priorityScore: 0.2, riskLevel: 'low', recommendedAction: 'monitor', balance: 100, daysOverdue: 0 },
      { arLedgerId: 'b', ledgerName: 'B', priorityScore: 0.8, riskLevel: 'high', recommendedAction: 'send_final_notice', balance: 100, daysOverdue: 0 },
      { arLedgerId: 'c', ledgerName: 'C', priorityScore: 0.5, riskLevel: 'medium', recommendedAction: 'send_reminder', balance: 100, daysOverdue: 0 },
    ];
    const ranked = rankCollections(scores);
    expect(ranked.map((s) => s.arLedgerId)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const scores: ArCollectionScore[] = [
      { arLedgerId: 'a', ledgerName: 'A', priorityScore: 0.2, riskLevel: 'low', recommendedAction: 'monitor', balance: 100, daysOverdue: 0 },
      { arLedgerId: 'b', ledgerName: 'B', priorityScore: 0.8, riskLevel: 'high', recommendedAction: 'send_final_notice', balance: 100, daysOverdue: 0 },
    ];
    rankCollections(scores);
    expect(scores[0]!.arLedgerId).toBe('a');
  });
});
