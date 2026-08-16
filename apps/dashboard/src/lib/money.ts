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

/**
 * THERE IS NO DEFAULT CURRENCY, deliberately.
 *
 * This file used to export DEFAULT_CURRENCY = 'USD' and fall back to it
 * whenever a record carried no code — which reintroduced, one line below the
 * comment explaining why it is wrong, exactly the bug it was written to fix.
 * A property trading in JPY renders a real ¥151,110 balance as a dollar figure
 * with two decimal places when the code is missing: a materially wrong number,
 * on a live ledger, in whichever party's disfavour the reader happens to guess.
 *
 * A symbol we invented is worse than no symbol at all, because it looks
 * authoritative. So an absent currency now renders the number PLAINLY — grouped
 * but unsymbolled — which is honest about what we know and visibly odd enough
 * that someone asks, rather than quietly wrong.
 */

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

  const code = (currencyCode || '').trim().toUpperCase();
  if (!code) {
    // No code, no symbol. Never guess one.
    return value.toLocaleString(locale);
  }
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

  const code = (currencyCode || '').trim().toUpperCase();
  if (!code) return value.toLocaleString(locale);
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
