import { describe, it, expect, vi, afterEach } from 'vitest';

describe('BirdSmsProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('is not configured without credentials', async () => {
    delete process.env['BIRD_ACCESS_KEY'];
    delete process.env['BIRD_ORIGINATOR'];
    const { BirdSmsProvider } = await import('./bird-sms.provider');
    const provider = new BirdSmsProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('sends via MessageBird REST when configured', async () => {
    process.env['BIRD_ACCESS_KEY'] = 'test-key';
    process.env['BIRD_ORIGINATOR'] = 'HAIP';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-bird-1' }),
    }) as any;

    const { BirdSmsProvider } = await import('./bird-sms.provider');
    const provider = new BirdSmsProvider();
    const result = await provider.send({ to: '+15551234567', body: 'Hello' });
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('msg-bird-1');
  });
});
