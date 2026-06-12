/**
 * PII scrubbing (for logging) and net-rate guarding (for responses sent to the GPT).
 *
 * Two independent transforms, both deep and non-mutating:
 *
 *  - redactForLog()  — replaces guest PII + bearer credentials with "[redacted]"
 *    before a tool call is written to Supabase. We keep the analytically useful
 *    fields (location, dates, occupancy, room/rate ids, rate types, result counts).
 *
 *  - stripNetRate()  — removes any wholesale/net/cost-basis fields from upstream
 *    responses before they reach ChatGPT. HAIP's Connect API already returns
 *    selling prices only, so this is defense-in-depth: it enforces the OTAIP rule
 *    ("the GPT sees the selling price only") even if a future HAIP change starts
 *    returning a net field.
 */

type Json = unknown;

/**
 * Keys (compared case-insensitively) whose values are guest PII or a booking
 * credential. Redacted — not removed — so the shape of logged payloads is stable.
 */
const PII_KEYS = new Set([
  'guestfirstname',
  'guestlastname',
  'guestname',
  'guestemail',
  'email',
  'guestphone',
  'phone',
  'loyaltynumber',
  'specialrequests',
  'paymenttoken',
  // Bearer credentials — possession of these authorizes booking access.
  'confirmationnumber',
  'cancellationnumber',
]);

/**
 * Keys (compared case-insensitively) that would expose net/wholesale/cost basis.
 * Exact-name matching is deliberate: a broad /cost/ regex would wrongly strip
 * legitimate selling-price fields such as `costDifference` (the change in the
 * guest-facing total on a modify).
 */
const NET_RATE_KEYS = new Set([
  'net',
  'netrate',
  'net_rate',
  'netamount',
  'net_amount',
  'netprice',
  'costrate',
  'cost_rate',
  'costprice',
  'cost_price',
  'costbasis',
  'wholesale',
  'wholesalerate',
  'wholesaleamount',
  'commission',
  'commissionrate',
  'commissionamount',
  'markup',
  'margin',
  'partnermargin',
  'profit',
]);

function transform(value: Json, keyMatches: (lowerKey: string) => 'redact' | 'drop' | 'keep'): Json {
  if (Array.isArray(value)) {
    return value.map((item) => transform(item, keyMatches));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [key, val] of Object.entries(value as Record<string, Json>)) {
      const decision = keyMatches(key.toLowerCase());
      if (decision === 'drop') continue;
      if (decision === 'redact') {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = transform(val, keyMatches);
    }
    return out;
  }
  return value;
}

/** Deep-redact guest PII and booking credentials for safe logging. */
export function redactForLog(value: Json): Json {
  return transform(value, (k) => (PII_KEYS.has(k) ? 'redact' : 'keep'));
}

/** Deep-remove any net/wholesale/cost-basis fields before a response reaches the GPT. */
export function stripNetRate(value: Json): Json {
  return transform(value, (k) => (NET_RATE_KEYS.has(k) ? 'drop' : 'keep'));
}
