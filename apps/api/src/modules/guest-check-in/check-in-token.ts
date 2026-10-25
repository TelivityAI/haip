import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CheckInTokenPayload {
  v: 1;
  reservationId: string;
  propertyId: string;
  /** Unix seconds */
  exp: number;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/** Sign a guest check-in magic-link payload (HMAC-SHA256). */
export function signCheckInToken(payload: CheckInTokenPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

/** Verify and parse a magic-link token. Returns null if invalid or expired. */
export function verifyCheckInToken(token: string, secret: string): CheckInTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret).update(body).digest();
  let actual: Buffer;
  try {
    actual = fromB64url(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromB64url(body).toString('utf8')) as CheckInTokenPayload;
    if (parsed?.v !== 1 || typeof parsed.reservationId !== 'string' || typeof parsed.propertyId !== 'string') {
      return null;
    }
    if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Default magic-link lifetime (48 hours). Staff may request up to 7 days. */
export function defaultTokenTtlSeconds(): number {
  return 48 * 60 * 60;
}

/** Upper bound for staff-issued check-in link TTL (7 days). */
export function maxTokenTtlSeconds(): number {
  return 7 * 24 * 60 * 60;
}
