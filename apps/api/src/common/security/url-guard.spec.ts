import { describe, it, expect, afterEach } from 'vitest';
import {
  isPrivateIp,
  isLiterallySafeHttpUrl,
  assertSafeOutboundUrl,
  assertSafeChannelEndpoint,
  UnsafeUrlError,
} from './url-guard';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1',
  ])('flags %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34'])(
    'allows public %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
});

describe('isLiterallySafeHttpUrl', () => {
  it('rejects non-http(s) schemes', () => {
    expect(isLiterallySafeHttpUrl('ftp://example.com')).toBe(false);
    expect(isLiterallySafeHttpUrl('file:///etc/passwd')).toBe(false);
  });
  it('rejects localhost and private/metadata literals', () => {
    expect(isLiterallySafeHttpUrl('http://localhost/x')).toBe(false);
    expect(isLiterallySafeHttpUrl('http://127.0.0.1/x')).toBe(false);
    expect(isLiterallySafeHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isLiterallySafeHttpUrl('http://10.0.0.5/internal')).toBe(false);
  });
  it('accepts a public https URL', () => {
    expect(isLiterallySafeHttpUrl('https://hooks.example.com/haip')).toBe(true);
  });
  it('enforces https when required', () => {
    expect(isLiterallySafeHttpUrl('http://hooks.example.com', { requireHttps: true })).toBe(false);
    expect(isLiterallySafeHttpUrl('https://hooks.example.com', { requireHttps: true })).toBe(true);
  });
});

describe('assertSafeOutboundUrl', () => {
  it('rejects a literal metadata IP without needing DNS', async () => {
    await expect(assertSafeOutboundUrl('http://169.254.169.254/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it('rejects an http URL when https is required', async () => {
    await expect(
      assertSafeOutboundUrl('http://1.1.1.1/', { requireHttps: true }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it('allows a public literal IP over https', async () => {
    await expect(assertSafeOutboundUrl('https://1.1.1.1/', { requireHttps: true })).resolves.toBeUndefined();
  });
});

describe('assertSafeChannelEndpoint', () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevAllow = process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'];
  afterEach(() => {
    process.env['NODE_ENV'] = prevEnv;
    if (prevAllow === undefined) delete process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'];
    else process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'] = prevAllow;
  });

  it('blocks an internal/metadata host in production', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'];
    await expect(assertSafeChannelEndpoint('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('allows a public host in production', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'];
    await expect(assertSafeChannelEndpoint('https://1.1.1.1/ota')).resolves.toBeUndefined();
  });

  it('allows private hosts outside production (local mock OTA servers)', async () => {
    process.env['NODE_ENV'] = 'test';
    await expect(assertSafeChannelEndpoint('http://127.0.0.1:8080/ota')).resolves.toBeUndefined();
  });

  it('allows private hosts in production when explicitly opted in', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CHANNEL_ALLOW_PRIVATE_ENDPOINTS'] = 'true';
    await expect(assertSafeChannelEndpoint('http://10.0.0.5/ota')).resolves.toBeUndefined();
  });
});
