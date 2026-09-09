import { createCipheriv, createHmac, timingSafeEqual } from 'crypto';
import { Decimal } from 'decimal.js';
import { assertLedgerCurrencySupported } from '@telivityhaip/booking-requests';

export const REDSYS_SIGNATURE_VERSION = 'HMAC_SHA512_V2';

/** Official sandbox FUC / terminal / secret (Redsys docs). */
export const REDSYS_SANDBOX = {
  merchantCode: '999008881',
  terminal: '001',
  secretKey: 'sq7HjrUOBfKmC576ILgskD5srU870gJ7',
} as const;

export const REDSYS_REDIRECT_URLS = {
  test: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  live: 'https://sis.redsys.es/sis/realizarPago',
} as const;

export const REDSYS_REST_URLS = {
  test: 'https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST',
  live: 'https://sis.redsys.es/sis/rest/trataPeticionREST',
} as const;

const CURRENCY_NUMERIC: Record<string, string> = {
  EUR: '978',
  USD: '840',
  GBP: '826',
  CHF: '756',
  JPY: '392',
};

export function redsysCurrencyCode(currency: string): string {
  const code = CURRENCY_NUMERIC[currency.trim().toUpperCase()];
  if (!code) {
    throw new Error(`Redsys does not support currency '${currency}'`);
  }
  return code;
}

/** Amount in minor units as a decimal-less string (e.g. 12.34 EUR → "1234"). */
export function redsysAmountString(amountMajor: number | string, currency = 'EUR'): string {
  redsysCurrencyCode(currency);
  const exponent = assertLedgerCurrencySupported(currency);
  const minor = new Decimal(amountMajor).times(new Decimal(10).pow(exponent));
  if (!minor.isFinite() || minor.lte(0) || !minor.isInteger()) {
    throw new Error(`Amount must be positive and use ${currency} minor units`);
  }
  return minor.toFixed(0);
}

/** Redsys order numbers: 4–12 chars, first 4 numeric. */
export function generateRedsysOrderId(now = Date.now()): string {
  const prefix = String(now % 1_000_000_000).padStart(4, '0').slice(-4);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${suffix}`.slice(0, 12);
}

export function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

export function normalizeAesKey(secretKey: string): Buffer {
  return Buffer.from(secretKey.slice(0, 16).padEnd(16, '\0'), 'utf8');
}

/**
 * Diversify the merchant secret with the order number (HMAC_SHA512_V2).
 * Returns Base64 of AES ciphertext — that UTF-8 string is the HMAC key.
 */
export function diversifyKey(secretKey: string, orderId: string): string {
  const key = normalizeAesKey(secretKey);
  const iv = Buffer.alloc(16, 0);
  const orderBuf = Buffer.from(orderId, 'utf8');
  const rem = orderBuf.length % 16;
  const padLen = rem === 0 ? 16 : 16 - rem;
  const pkcs = Buffer.concat([orderBuf, Buffer.alloc(padLen, padLen)]);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(pkcs), cipher.final()]).toString('base64');
}

export function encodeMerchantParameters(params: Record<string, string>): string {
  return toBase64Url(JSON.stringify(params));
}

export function decodeMerchantParameters<T extends Record<string, string> = Record<string, string>>(
  encoded: string,
): T {
  return JSON.parse(fromBase64Url(encoded).toString('utf8')) as T;
}

export function signMerchantParameters(
  merchantParametersBase64Url: string,
  secretKey: string,
  orderId: string,
): string {
  const digest = createHmac('sha512', diversifyKey(secretKey, orderId))
    .update(merchantParametersBase64Url)
    .digest();
  return toBase64Url(digest);
}

export function verifyMerchantParametersSignature(
  merchantParametersBase64Url: string,
  signatureBase64Url: string,
  secretKey: string,
  orderId: string,
): boolean {
  const expected = signMerchantParameters(merchantParametersBase64Url, secretKey, orderId);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureBase64Url);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Ds_Response success codes:
 * - 0000–0099: authorization / preauthorization approved
 * - 0900: capture / refund confirmed
 * - 0400: void / cancellation confirmed
 */
export function isRedsysSuccessResponse(dsResponse: string | undefined): boolean {
  if (!dsResponse) return false;
  const n = Number.parseInt(dsResponse, 10);
  if (!Number.isFinite(n)) return false;
  if (n >= 0 && n < 100) return true;
  return n === 900 || n === 400;
}
