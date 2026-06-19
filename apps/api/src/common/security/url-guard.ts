import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF protection for server-side outbound requests to user-supplied URLs
 * (webhook delivery, etc.). Rejects non-http(s) schemes and any host that
 * resolves to a private / loopback / link-local / metadata address.
 */

export class UnsafeUrlError extends Error {}

function ipv4ToParts(ip: string): number[] | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** True for loopback / private / link-local / CGNAT / metadata / unspecified ranges. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ipv4ToParts(ip);
    if (!p) return true; // unparseable → treat as unsafe
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (ip6 === '::1' || ip6 === '::') return true; // loopback / unspecified
    if (ip6.startsWith('fe80') || ip6.startsWith('fc') || ip6.startsWith('fd')) return true; // link-local / ULA
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4
    const mapped = ip6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return false;
  }
  return true; // not an IP literal handled here
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true;
  }
  if (isIP(h) && isPrivateIp(h)) return true;
  return false;
}

/**
 * Validate a URL is a safe public http(s) target. Resolves DNS and re-checks the
 * resolved addresses to defeat DNS-rebinding. Throws UnsafeUrlError otherwise.
 */
export async function assertSafeOutboundUrl(
  raw: string,
  opts: { requireHttps?: boolean } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  const scheme = url.protocol.replace(/:$/, '');
  if (opts.requireHttps ? scheme !== 'https' : scheme !== 'http' && scheme !== 'https') {
    throw new UnsafeUrlError(`Disallowed URL scheme: ${scheme}`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw new UnsafeUrlError('URL host is not allowed (private/loopback)');
  }
  // If the host is a DNS name, resolve and re-check every address.
  if (isIP(hostname) === 0) {
    let addrs: { address: string }[];
    try {
      addrs = await lookup(hostname, { all: true });
    } catch {
      throw new UnsafeUrlError('URL host could not be resolved');
    }
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
      throw new UnsafeUrlError('URL host resolves to a private address');
    }
  }
}

/**
 * SSRF guard for outbound OTA channel-adapter requests. The endpoint base URL
 * comes from tenant-supplied channel-connection config, so a property admin could
 * point it at an internal/metadata host and trigger a server-side fetch. Block
 * private targets in production. Local/dev (docker mock OTA servers on private
 * hosts) is allowed unless explicitly locked down, mirroring the project's
 * NODE_ENV / opt-in posture (cf. HAIP_ALLOW_INSECURE).
 */
export async function assertSafeChannelEndpoint(raw: string): Promise<void> {
  const enforce =
    process.env['NODE_ENV'] === 'production' &&
    process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'] !== 'true';
  if (!enforce) return;
  await assertSafeOutboundUrl(raw);
}

/** Sync, literal-only check for DTO validation (no DNS). */
export function isLiterallySafeHttpUrl(raw: string, opts: { requireHttps?: boolean } = {}): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const scheme = url.protocol.replace(/:$/, '');
  if (opts.requireHttps ? scheme !== 'https' : scheme !== 'http' && scheme !== 'https') return false;
  return !isBlockedHostname(url.hostname.replace(/^\[|\]$/g, ''));
}
