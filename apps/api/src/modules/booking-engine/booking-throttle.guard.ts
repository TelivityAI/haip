import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Tight per-route rate limiter applied ONLY to `POST /booking-engine/book`
 * (the endpoint that creates a guest + reservation + takes payment).
 *
 * The global `RateLimitGuard` already covers search/quote with a generous limit;
 * the payment endpoint needs a much tighter brake against card-testing / spam
 * bookings. Keyed by `ip + propertyId` (so one abusive source can't exhaust
 * another tenant's budget). Same in-memory fixed-window approach as the global
 * guard; Redis is the production upgrade path.
 *
 * Tunable: BOOKING_RATE_LIMIT_MAX (default 10) per BOOKING_RATE_LIMIT_WINDOW_MS
 * (default 60000). Disabled when NODE_ENV=test or RATE_LIMIT_DISABLED=true.
 */
@Injectable()
export class BookingThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly disabled: boolean;
  private readonly trustProxy: boolean;

  constructor(private readonly configService: ConfigService) {
    this.max = Number(this.configService.get('BOOKING_RATE_LIMIT_MAX', '10')) || 10;
    this.windowMs =
      Number(this.configService.get('BOOKING_RATE_LIMIT_WINDOW_MS', '60000')) || 60000;
    this.disabled =
      process.env['NODE_ENV'] === 'test' ||
      this.configService.get<string>('RATE_LIMIT_DISABLED', 'false') === 'true';
    this.trustProxy =
      this.configService.get<string>('RATE_LIMIT_TRUST_PROXY', 'false') === 'true';
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.disabled) return true;
    const req = context.switchToHttp().getRequest();
    if (!req) return true;

    const propertyId = req.bookingEngine?.propertyId ?? req.body?.propertyId ?? 'unknown';
    const key = `${this.clientIp(req)}:${propertyId}`;
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    entry.count++;
    if (entry.count > this.max) {
      throw new HttpException('Too many booking attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private clientIp(req: any): string {
    if (this.trustProxy) {
      const fwd = req.headers?.['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private sweep(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }
}
