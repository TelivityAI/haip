import { describe, it, expect } from 'vitest';
import { assertSecureConfig } from './assert-secure-config';

describe('assertSecureConfig', () => {
  it('does nothing outside production', () => {
    expect(() => assertSecureConfig({ NODE_ENV: 'development', AUTH_ENABLED: 'false', STRIPE_MODE: 'mock' } as any)).not.toThrow();
  });

  it('refuses to boot in production with AUTH disabled', () => {
    expect(() => assertSecureConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'false', STRIPE_MODE: 'live' } as any)).toThrow(/AUTH_ENABLED=false/);
  });

  it('refuses to boot in production with mock payments', () => {
    expect(() => assertSecureConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'true', STRIPE_MODE: 'mock' } as any)).toThrow(/mock/);
  });

  it('allows production when PAYMENT_GATEWAY is a real PSP even if STRIPE_MODE=mock', () => {
    expect(() =>
      assertSecureConfig({
        NODE_ENV: 'production',
        AUTH_ENABLED: 'true',
        STRIPE_MODE: 'mock',
        PAYMENT_GATEWAY: 'adyen',
      } as any),
    ).not.toThrow();
  });

  it('also refuses to boot in staging with AUTH disabled (not just production)', () => {
    expect(() => assertSecureConfig({ NODE_ENV: 'staging', AUTH_ENABLED: 'false', STRIPE_MODE: 'live' } as any)).toThrow(/AUTH_ENABLED=false/);
  });

  it('allows the explicit insecure opt-in (public demo)', () => {
    expect(() =>
      assertSecureConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'false', STRIPE_MODE: 'mock', HAIP_ALLOW_INSECURE: 'true' } as any),
    ).not.toThrow();
  });

  it('passes a properly-configured production', () => {
    expect(() => assertSecureConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'true', STRIPE_MODE: 'live' } as any)).not.toThrow();
  });
});
