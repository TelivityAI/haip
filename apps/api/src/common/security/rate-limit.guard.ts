import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal in-memory fixed-window rate limiter (dependency-free stand-in for
 * @nestjs/throttler). Global, per client IP. This is an INTERIM brute-force
 * mitigation — notably for the Connect confirmation-number enumeration — pending
 * the C2 credential redesign.
 *
 * Tunable via env: RATE_LIMIT_MAX (default 300) per RATE_LIMIT_WINDOW_MS
 * (default 60000). Disabled when NODE_ENV=test or RATE_LIMIT_DISABLED=true.
 * In-memory only (per instance); a Redis-backed limiter is the production
 * upgrade path.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly disabled: boolean;
  private readonly trustProxy: boolean;

  constructor(private readonly configService: ConfigService) {
    this.max = Number(this.configService.get('RATE_LIMIT_MAX', '300')) || 300;
    this.windowMs = Number(this.configService.get('RATE_LIMIT_WINDOW_MS', '60000')) || 60000;
    this.disabled =
      process.env['NODE_ENV'] === 'test' ||
      this.configService.get<string>('RATE_LIMIT_DISABLED', 'false') === 'true';
    // Only honor X-Forwarded-For behind a trusted proxy. Default OFF: otherwise a
    // client rotates the header to get a fresh window every request and the limit
    // is meaningless (it's the only brake on confirmation-number brute force).
    this.trustProxy =
      this.configService.get<string>('RATE_LIMIT_TRUST_PROXY', 'false') === 'true';
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.disabled) return true;
    const req = context.switchToHttp().getRequest();
    if (!req) return true; // non-HTTP (ws) contexts

    const ip = this.clientIp(req);
    const now = Date.now();
    const entry = this.hits.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(ip, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    entry.count++;
    if (entry.count > this.max) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private clientIp(req: any): string {
    if (this.trustProxy) {
      const fwd = req.headers?.['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
    }
    // Untrusted by default: use the real socket peer, which a client can't spoof.
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  /** Bound memory: drop expired windows occasionally. */
  private sweep(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }
}
