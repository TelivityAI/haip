export type MoneyInputError =
  | 'required'
  | 'format'
  | 'positive'
  | 'precision'
  | 'unsupportedCurrency'
  | 'maximum';

export interface ValidatedDecimalInput {
  canonical: string | null;
  error: MoneyInputError | null;
}

const DECIMAL_INPUT = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function currencyExponent(currencyCode: string): number | null {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

function validateDecimal(
  value: string,
  maximumFractionDigits: number,
  maximum?: number,
): ValidatedDecimalInput {
  if (value === '') return { canonical: null, error: 'required' };
  const match = DECIMAL_INPUT.exec(value);
  if (!match) return { canonical: null, error: 'format' };
  const fraction = match[2] ?? '';
  if (fraction.length > maximumFractionDigits) {
    return { canonical: null, error: 'precision' };
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { canonical: null, error: 'format' };
  if (numeric <= 0) return { canonical: null, error: 'positive' };
  if (maximum != null && numeric > maximum) {
    return { canonical: null, error: 'maximum' };
  }
  const [whole] = value.split('.');
  return {
    canonical: maximumFractionDigits === 0
      ? whole!
      : `${whole}.${fraction.padEnd(maximumFractionDigits, '0')}`,
    error: null,
  };
}

export function validateMoneyInput(
  value: string,
  currencyCode: string,
): ValidatedDecimalInput {
  const exponent = currencyExponent(currencyCode);
  if (exponent == null || exponent > 2) {
    return { canonical: null, error: 'unsupportedCurrency' };
  }
  return validateDecimal(value, exponent);
}

export function validatePercentageInput(value: string): ValidatedDecimalInput {
  return validateDecimal(value, 2, 100);
}
