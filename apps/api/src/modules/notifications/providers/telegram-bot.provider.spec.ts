import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramBotProvider } from './telegram-bot.provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('TelegramBotProvider', () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env['TELEGRAM_BOT_TOKEN'] = '123:ABC';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reports not configured without token', () => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    const provider = new TelegramBotProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('calls Telegram sendMessage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });
    const provider = new TelegramBotProvider();
    const result = await provider.send({ to: '999', body: 'Welcome' });

    expect(result).toMatchObject({ sent: true, provider: 'telegram', messageId: '42' });
    expect(mockFetch.mock.calls[0][0]).toContain('/bot123:ABC/sendMessage');
  });
});
