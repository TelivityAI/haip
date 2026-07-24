import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VonageSmsProvider } from './vonage-sms.provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('VonageSmsProvider', () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env['VONAGE_API_KEY'] = 'key';
    process.env['VONAGE_API_SECRET'] = 'secret';
    process.env['VONAGE_SMS_FROM'] = '15551230000';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reports not configured without credentials', () => {
    delete process.env['VONAGE_API_SECRET'];
    const provider = new VonageSmsProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('posts SMS via Vonage Messages API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message_uuid: 'von-uuid' }),
    });
    const provider = new VonageSmsProvider();
    const result = await provider.send({ to: '+447700900000', body: 'Hi' });

    expect(result).toMatchObject({ sent: true, provider: 'vonage', messageId: 'von-uuid' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.channel).toBe('sms');
    expect(body.to).toBe('447700900000');
  });
});
