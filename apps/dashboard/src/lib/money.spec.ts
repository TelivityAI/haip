/**
 * Money formatting, tested on the case that put a wrong number on a live folio.
 *
 * The formatter used to fall back to a hardcoded USD when a record carried no
 * currency code, so a real ¥151,110 balance on a JPY property rendered as a
 * dollar figure with two decimal places — authoritative-looking and materially
 * wrong. The fix is that there is no fallback at all.
 *
 * These assert BEHAVIOUR rather than exact glyphs: ICU renders JPY as "¥" in
 * some versions and "JP¥" in others, and a test that pins the symbol would fail
 * on a runner upgrade while telling us nothing about the defect.
 */
import { describe, expect, it } from 'vitest';

import { formatMoney } from './money';

describe('formatMoney', () => {
  it('renders JPY with no minor units', () => {
    const out = formatMoney('151110', 'JPY', 'en-US');
    expect(out).toContain('151,110');
    expect(out).not.toContain('.');       // zero-decimal currency
  });

  it('never invents a currency when the code is missing', () => {
    // The whole defect: these used to come back as dollar amounts.
    for (const missing of [undefined, null, '', '   ']) {
      const out = formatMoney('151110', missing, 'en-US');
      expect(out).toBe('151,110');        // grouped, unsymbolled, honest
      expect(out).not.toContain('$');
      expect(out).not.toContain('USD');
    }
  });

  it('still renders minor units where the currency has them', () => {
    expect(formatMoney('1234.5', 'USD', 'en-US')).toContain('1,234.50');
  });

  it('distinguishes an absent amount from a zero balance', () => {
    expect(formatMoney(null, 'JPY', 'en-US')).toBe('—');
    expect(formatMoney(undefined, 'JPY', 'en-US')).toBe('—');
    expect(formatMoney('', 'JPY', 'en-US')).toBe('—');
    expect(formatMoney('0', 'JPY', 'en-US')).toContain('0');
    expect(formatMoney('0', 'JPY', 'en-US')).not.toBe('—');
  });

  it('degrades to a plain number for an unknown code rather than throwing', () => {
    // A bad code must not take down a page that was only showing a total.
    expect(formatMoney('1000', 'NOTACODE', 'en-US')).toContain('1,000');
  });

  it('returns an em dash for a non-numeric amount', () => {
    expect(formatMoney('not money', 'JPY', 'en-US')).toBe('—');
  });
});
