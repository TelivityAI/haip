import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { IsMoneyString } from './is-money-string.validator';

class Positive {
  @IsMoneyString()
  amount!: string;
}
class NonNeg {
  @IsMoneyString({ allowZero: true })
  amount!: string;
}
class Signed {
  @IsMoneyString({ allowNegative: true })
  amount!: string;
}

async function fails(obj: any): Promise<boolean> {
  const errors = await validate(obj);
  return errors.length > 0;
}

describe('IsMoneyString', () => {
  it('positive (default): accepts a positive decimal string', async () => {
    expect(await fails(Object.assign(new Positive(), { amount: '150.00' }))).toBe(false);
  });

  it('positive (default): rejects negative, zero, NaN, empty, and non-numeric', async () => {
    for (const v of ['-1.00', '0', '0.00', 'abc', '', '   ', 'Infinity', '1,234.50']) {
      expect(await fails(Object.assign(new Positive(), { amount: v }))).toBe(true);
    }
  });

  it('allowZero: accepts 0 and positive, still rejects negative', async () => {
    expect(await fails(Object.assign(new NonNeg(), { amount: '0' }))).toBe(false);
    expect(await fails(Object.assign(new NonNeg(), { amount: '12.50' }))).toBe(false);
    expect(await fails(Object.assign(new NonNeg(), { amount: '-0.01' }))).toBe(true);
  });

  it('allowNegative: accepts negatives (credits) but still rejects garbage', async () => {
    expect(await fails(Object.assign(new Signed(), { amount: '-50.00' }))).toBe(false);
    expect(await fails(Object.assign(new Signed(), { amount: '50.00' }))).toBe(false);
    expect(await fails(Object.assign(new Signed(), { amount: 'nope' }))).toBe(true);
  });
});
