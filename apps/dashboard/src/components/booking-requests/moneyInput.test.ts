import { describe, expect, it } from 'vitest';
import { validateMoneyInput, validatePercentageInput } from './moneyInput';

describe('booking request money input', () => {
  it('canonicalizes by padding only and never rounds staff input', () => {
    expect(validateMoneyInput('75', 'EUR')).toEqual({ canonical: '75.00', error: null });
    expect(validateMoneyInput('75.5', 'EUR')).toEqual({ canonical: '75.50', error: null });
    expect(validateMoneyInput('75.555', 'EUR')).toEqual({ canonical: null, error: 'precision' });
  });

  it('enforces zero-decimal currencies and rejects unsupported three-decimal ledgers', () => {
    expect(validateMoneyInput('120', 'JPY')).toEqual({ canonical: '120', error: null });
    expect(validateMoneyInput('120.0', 'JPY')).toEqual({ canonical: null, error: 'precision' });
    expect(validateMoneyInput('1.000', 'KWD')).toEqual({ canonical: null, error: 'unsupportedCurrency' });
  });

  it('distinguishes nonnumeric, noncanonical, and nonpositive values', () => {
    expect(validateMoneyInput('abc', 'EUR').error).toBe('format');
    expect(validateMoneyInput('01.00', 'EUR').error).toBe('format');
    expect(validateMoneyInput('0.00', 'EUR').error).toBe('positive');
    expect(validateMoneyInput('', 'EUR').error).toBe('required');
  });

  it('validates percentages without floating-point rounding', () => {
    expect(validatePercentageInput('30.5')).toEqual({ canonical: '30.50', error: null });
    expect(validatePercentageInput('30.555').error).toBe('precision');
    expect(validatePercentageInput('100.01').error).toBe('maximum');
  });
});
