import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Per-connection inbound authentication (closes CRITICAL #3 from the security audit).
 *
 * Each `channelConnections.config.inboundAuth` carries the credentials a specific
 * OTA must present when pushing into HAIP:
 *
 *   { username: '...', password: '...' }                  // Basic Auth (Booking.com)
 *   { secret: '...' }                                     // HMAC-SHA256 (Expedia & similar)
 *
 * The previous code never validated the `Authorization` header at all, so anyone
 * who reached the public webhook URL could inject reservations/cancellations.
 *
 * `config.inboundAuth` lives inside the existing encrypted-at-app `config` jsonb;
 * no schema change required.
 */
export interface InboundBasicAuth {
  username: string;
  password: string;
}
export interface InboundHmacAuth {
  /** Shared secret used as the HMAC-SHA256 key (raw, not hashed). */
  secret: string;
}

/** Constant-time string compare — never short-circuit on length mismatch leak. */
function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Constant-time hex compare. Used for HMAC signature comparison. */
function safeEqualHex(a: string, b: string): boolean {
  return safeEqualStr(a.toLowerCase(), b.toLowerCase());
}

/**
 * Verify a `Authorization: Basic <base64(user:pass)>` header against the stored
 * Basic-Auth credentials on a channel connection. Returns true iff both match in
 * constant time. Missing creds → false (fail closed).
 */
export function verifyBasicAuth(
  authHeader: string | undefined | null,
  stored: InboundBasicAuth | undefined,
): boolean {
  if (!stored?.username || !stored?.password) return false;
  if (typeof authHeader !== 'string' || !authHeader) return false;
  const m = /^Basic\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return safeEqualStr(user, stored.username) && safeEqualStr(pass, stored.password);
}

/**
 * Verify an HMAC-SHA256 signature header against a shared secret over the raw
 * request body. Header is the hex digest (most providers emit hex; some prefix
 * `sha256=` which we strip). Constant-time compare; fail closed on missing input.
 */
export function verifyHmacSignature(
  signatureHeader: string | undefined | null,
  rawBody: string,
  stored: InboundHmacAuth | undefined,
): boolean {
  if (!stored?.secret) return false;
  if (typeof signatureHeader !== 'string' || !signatureHeader) return false;
  const provided = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  const expected = createHmac('sha256', stored.secret).update(rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  return safeEqualHex(provided, expected);
}

/** Extract `inboundAuth` from a channel connection's `config` jsonb safely. */
export function getInboundAuth<T = InboundBasicAuth | InboundHmacAuth>(
  config: unknown,
): T | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const cfg = config as Record<string, unknown>;
  const ia = cfg['inboundAuth'];
  if (!ia || typeof ia !== 'object') return undefined;
  return ia as T;
}
