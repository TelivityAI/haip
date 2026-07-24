import { describe, it, expect, vi, afterEach } from 'vitest';

describe('WhatsappCloudProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('reports not configured without token', async () => {
    delete process.env['WHATSAPP_CLOUD_TOKEN'];
    delete process.env['WHATSAPP_CLOUD_PHONE_NUMBER_ID'];
    const { WhatsappCloudProvider } = await import('./whatsapp-cloud.provider');
    const provider = new WhatsappCloudProvider();
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.send({ to: '+15551234567', body: 'hi' });
    expect(result.sent).toBe(false);
    expect(result.provider).toBe('whatsapp-cloud');
  });

  it('sends text via Graph API when configured', async () => {
    process.env['WHATSAPP_CLOUD_TOKEN'] = 'token';
    process.env['WHATSAPP_CLOUD_PHONE_NUMBER_ID'] = '123456';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    }) as any;

    const { WhatsappCloudProvider } = await import('./whatsapp-cloud.provider');
    const provider = new WhatsappCloudProvider();
    expect(provider.isConfigured()).toBe(true);
    const result = await provider.send({ to: '+15551234567', body: 'hello' });
    expect(result).toEqual({
      sent: true,
      provider: 'whatsapp-cloud',
      messageId: 'wamid.1',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123456/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
