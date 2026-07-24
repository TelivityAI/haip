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
  const prev = process.env['DOOR_LOCK_PROVIDER'];

  afterEach(() => {
    if (prev === undefined) delete process.env['DOOR_LOCK_PROVIDER'];
    else process.env['DOOR_LOCK_PROVIDER'] = prev;
  });

  it('defaults to webhook when configured', () => {
    delete process.env['DOOR_LOCK_PROVIDER'];
    const webhook = stubProvider('webhook', true);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([webhook, consoleProvider]);
    expect(factory.resolve()).toBe(webhook);
  });

  it('selects nuki when configured', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'nuki';
    const nuki = stubProvider('nuki', true);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([nuki, consoleProvider]);
    expect(factory.resolve()).toBe(nuki);
  });

  it('falls back to console when vendor is not configured', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'ttlock';
    const ttlock = stubProvider('ttlock', false);
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([ttlock, consoleProvider]);
    expect(factory.resolve()).toBe(consoleProvider);
  });

  it('falls back to console for unknown provider names', () => {
    process.env['DOOR_LOCK_PROVIDER'] = 'unknown-vendor';
    const consoleProvider = stubProvider('console', true);
    const factory = new LockProviderFactory([consoleProvider]);
    expect(factory.resolve()).toBe(consoleProvider);
  });
});
