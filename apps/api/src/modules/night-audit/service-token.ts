import { createHash, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

/** Compare bearer tokens without leaking the secret through a length check. */
export function serviceTokenMatches(presented: string, expected: string): boolean {
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function assertNightAuditServiceToken(authorization: string | undefined): void {
  const expected = process.env['HAIP_SERVICE_TOKEN'];
  if (!expected) {
    throw new ServiceUnavailableException('HAIP_SERVICE_TOKEN is not configured');
  }
  const presented = String(authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!presented || !serviceTokenMatches(presented, expected)) {
    throw new UnauthorizedException('Invalid night audit service token');
  }
}
