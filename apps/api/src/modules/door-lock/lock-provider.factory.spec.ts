import { describe, it, expect, afterEach, vi } from 'vitest';
import { LockProviderFactory } from './lock-provider.factory';
import type { LockProvider } from './lock-provider.interface';

function stubProvider(name: string, configured: boolean): LockProvider {
  return {
    name,
    isConfigured: () => configured,
    issueCredential: vi.fn(),
    revokeCredential: vi.fn(),
  };
}

describe('LockProviderFactory', () => {
  const prevProvider = process.env['DOOR_LOCK_PROVIDER'];
  const prevEnv = process.env['NODE_ENV'];
  const prevInsecure = process.env['HAIP_ALLOW_INSECURE'];

  afterEach(() => {
    if (prevProvider === undefined) delete process.env['DOOR_LOCK_PROVIDER'];
    else process.env['DOOR_LOCK_PROVIDER'] = prevProvider;
    if (prevEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = prevEnv;
    if (prevInsecure === undefined) delete process.env['HAIP_ALLOW_INSECURE'];
    else process.env['HAIP_ALLOW_INSECURE'] = prevInsecure;
  });

  it('defaults to webhook when configured', () => {
    delete process.env['DOOR_LOCK_PROVIDER'];
    process.env['NODE_ENV'] = 'test';
    const webhook = stubProvider('webhook', true);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([webhook, consoleProvider]);
    expect(factory.resolve()).toBe(webhook);
  });

  it('selects nuki when configured', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'nuki';
    process.env['NODE_ENV'] = 'test';
    const nuki = stubProvider('nuki', true);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([nuki, consoleProvider]);
    expect(factory.resolve()).toBe(nuki);
  });

  it('falls back to console when vendor is not configured in non-production', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'ttlock';
    process.env['NODE_ENV'] = 'development';
    const ttlock = stubProvider('ttlock', false);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([ttlock, consoleProvider]);
    expect(factory.resolve()).toBe(consoleProvider);
  });

  it('falls back to console for unknown provider names in non-production', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'unknown-vendor';
    process.env['NODE_ENV'] = 'test';
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([consoleProvider]);
    expect(factory.resolve()).toBe(consoleProvider);
  });

  it('fails closed in production when vendor is not configured', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'nuki';
    process.env['NODE_ENV'] = 'production';
    delete process.env['HAIP_ALLOW_INSECURE'];
    const nuki = stubProvider('nuki', false);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([nuki, consoleProvider]);
    expect(() => factory.resolve()).toThrow(/not configured|refusing console/i);
  });

  it('refuses explicit console provider in production', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'console';
    process.env['NODE_ENV'] = 'production';
    delete process.env['HAIP_ALLOW_INSECURE'];
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([consoleProvider]);
    expect(() => factory.resolve()).toThrow(/not allowed in production/i);
  });

  it('allows console in production when HAIP_ALLOW_INSECURE=true', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'console';
    process.env['NODE_ENV'] = 'production';
    process.env['HAIP_ALLOW_INSECURE'] = 'true';
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([consoleProvider]);
    expect(factory.resolve()).toBe(consoleProvider);
  });
});
