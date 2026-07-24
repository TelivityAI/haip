import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InfobipSmsProvider } from './infobip-sms.provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('InfobipSmsProvider', () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env['INFOBIP_API_KEY'] = 'key';
    process.env['INFOBIP_SMS_FROM'] = 'Hotel';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reports not configured without credentials', () => {
    delete process.env['INFOBIP_API_KEY'];
    const provider = new InfobipSmsProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('posts to Infobip advanced SMS API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ messageId: 'ib-msg-1' }] }),
    });
    const provider = new InfobipSmsProvider();
    const result = await provider.send({ to: '+15551230000', body: 'Hello' });

    expect(result).toMatchObject({ sent: true, provider: 'infobip', messageId: 'ib-msg-1' });
    expect(mockFetch.mock.calls[0][0]).toContain('/sms/2/text/advanced');
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('App key');
  });
});
