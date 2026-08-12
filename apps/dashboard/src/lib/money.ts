/**
 * Currency formatting for the dashboard.
 *
 * Money is stored and returned with an explicit `currencyCode` on every record,
 * but the UI historically rendered `$${amount.toFixed(2)}` — a hardcoded symbol
 * and a hardcoded two decimal places. That is wrong twice for a property trading
 * in anything else: the symbol is someone else's, and zero-decimal currencies
 * (JPY, KRW, VND, CLP…) do not have minor units at all, so ¥511,275 rendered as
 * "$511275.00".
 *
 * Intl.NumberFormat already knows the symbol, the separators and the correct
 * number of fraction digits for every ISO 4217 code, so it does the work here.
 */

/** Fallback when a record carries no currency and no property is selected. */
export const DEFAULT_CURRENCY = 'USD';

/**
 * The active property's currency, pushed here by PropertyContext.
 *
 * Same pattern the API client already uses for propertyId (`setPropertyId` in
 * lib/api.ts): a module-level value the context keeps current. It means a money
 * render does not need the currency threaded into every component that happens
 * to display an amount — dozens of call sites across the dashboard, many inside
 * helpers that cannot call a hook at all.
 */
let activeCurrency = DEFAULT_CURRENCY;

export function setActiveCurrency(code?: string | null) {
  activeCurrency = (code || DEFAULT_CURRENCY).toUpperCase();
}

export function getActiveCurrency() {
  return activeCurrency;
}

/**
 * Format a money value for display.
 *
 * @param amount        number or numeric string (the API returns money as strings)
 * @param currencyCode  ISO 4217 code from the record, or the active property's
 * @param locale        defaults to the browser's, so separators match the viewer
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currencyCode?: string | null,
  locale?: string,
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';

  const code = (currencyCode || activeCurrency).toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(value);
  } catch {
    // Unknown/invalid code: show the number with the code rather than a wrong symbol.
    return `${value.toLocaleString(locale)} ${code}`;
  }
}

/**
 * Format without the symbol — for table columns that carry the currency in the
 * header, and for inputs where a symbol would have to be stripped before parsing.
 */
export function formatMoneyPlain(
  amount: number | string | null | undefined,
  currencyCode?: string | null,
  locale?: string,
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';

  const code = (currencyCode || activeCurrency).toUpperCase();
  try {
    const digits = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return value.toLocaleString(locale);
  }
}
