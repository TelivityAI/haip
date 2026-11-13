import { describe, expect, it, afterEach } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { assertNightAuditServiceToken } from './service-token';

describe('assertNightAuditServiceToken', () => {
  const previous = process.env.HAIP_SERVICE_TOKEN;
  afterEach(() => {
    if (previous === undefined) delete process.env.HAIP_SERVICE_TOKEN;
    else process.env.HAIP_SERVICE_TOKEN = previous;
  });

  it('returns 503 when the token is not configured and 401 when it does not match', () => {
    delete process.env.HAIP_SERVICE_TOKEN;
    expect(() => assertNightAuditServiceToken('Bearer secret')).toThrow(ServiceUnavailableException);
    process.env.HAIP_SERVICE_TOKEN = 'correct-token';
    expect(() => assertNightAuditServiceToken('Bearer wrong')).toThrow(UnauthorizedException);
    expect(() => assertNightAuditServiceToken('Bearer correct-token')).not.toThrow();
  });
});
