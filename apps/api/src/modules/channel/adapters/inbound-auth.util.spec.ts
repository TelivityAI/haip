import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyBasicAuth,
  verifyHmacSignature,
  verifyBearerAuth,
  getInboundAuth,
} from './inbound-auth.util';

describe('inbound-auth.util — verifyBasicAuth', () => {
  const stored = { username: 'bc_user', password: 'bc_pass' };
  const goodHeader = `Basic ${Buffer.from('bc_user:bc_pass').toString('base64')}`;

  it('accepts the correct username + password', () => {
    expect(verifyBasicAuth(goodHeader, stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const bad = `Basic ${Buffer.from('bc_user:nope').toString('base64')}`;
    expect(verifyBasicAuth(bad, stored)).toBe(false);
  });

  it('rejects a wrong username (auth for tenant A used against tenant B)', () => {
    const other = `Basic ${Buffer.from('attacker_user:bc_pass').toString('base64')}`;
    expect(verifyBasicAuth(other, stored)).toBe(false);
  });

  it('rejects a missing Authorization header', () => {
    expect(verifyBasicAuth(undefined, stored)).toBe(false);
  });

  it('rejects when stored credentials are not configured (fail closed)', () => {
    expect(verifyBasicAuth(goodHeader, undefined)).toBe(false);
    expect(verifyBasicAuth(goodHeader, { username: '', password: '' })).toBe(false);
  });

  it('rejects non-Basic auth schemes', () => {
    expect(verifyBasicAuth('Bearer something', stored)).toBe(false);
  });
});

describe('inbound-auth.util — verifyHmacSignature', () => {
  const stored = { secret: 'expedia-shared-secret' };
  const body = '<BookingNotification>raw xml</BookingNotification>';
  const goodSig = createHmac('sha256', stored.secret).update(body).digest('hex');

  it('accepts a correct signature', () => {
    expect(verifyHmacSignature(goodSig, body, stored)).toBe(true);
  });

  it("accepts a 'sha256=' prefix", () => {
    expect(verifyHmacSignature(`sha256=${goodSig}`, body, stored)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyHmacSignature(goodSig, body + 'tamper', stored)).toBe(false);
  });

  it('rejects when secret is wrong (auth for tenant A used against tenant B)', () => {
    const otherSecret = { secret: 'other-tenant-secret' };
    expect(verifyHmacSignature(goodSig, body, otherSecret)).toBe(false);
  });

  it('rejects missing signature / missing secret', () => {
    expect(verifyHmacSignature(undefined, body, stored)).toBe(false);
    expect(verifyHmacSignature(goodSig, body, undefined)).toBe(false);
    expect(verifyHmacSignature(goodSig, body, { secret: '' })).toBe(false);
  });

  it('rejects a non-hex signature', () => {
    expect(verifyHmacSignature('not-hex-!!!', body, stored)).toBe(false);
  });
});

describe('inbound-auth.util — verifyBearerAuth', () => {
  const stored = { bearerToken: 'derby-inbound-secret' };

  it('accepts the correct Bearer token', () => {
    expect(verifyBearerAuth('Bearer derby-inbound-secret', stored)).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(verifyBearerAuth('Bearer other-tenant', stored)).toBe(false);
  });

  it('rejects missing header or missing stored token', () => {
    expect(verifyBearerAuth(undefined, stored)).toBe(false);
    expect(verifyBearerAuth('Bearer derby-inbound-secret', undefined)).toBe(false);
  });

  it('rejects Basic auth schemes', () => {
    expect(verifyBearerAuth('Basic abc', stored)).toBe(false);
  });
});

describe('inbound-auth.util — getInboundAuth', () => {
  it('returns the embedded auth object when present', () => {
    expect(getInboundAuth({ inboundAuth: { username: 'u', password: 'p' } })).toEqual({ username: 'u', password: 'p' });
  });
  it('returns undefined when missing or malformed', () => {
    expect(getInboundAuth(undefined)).toBeUndefined();
    expect(getInboundAuth({})).toBeUndefined();
    expect(getInboundAuth({ inboundAuth: 'no' as any })).toBeUndefined();
  });
});
