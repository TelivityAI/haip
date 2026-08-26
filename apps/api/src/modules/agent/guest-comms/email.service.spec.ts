import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from './email.service';
import type { EmailProvider } from './email-provider.interface';

describe('EmailService', () => {
  const consoleProvider: EmailProvider = {
    name: 'console',
    isConfigured: () => true,
    send: vi.fn().mockResolvedValue({ sent: false, provider: 'console', error: 'logged' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers SendGrid over SMTP when both configured', async () => {
    const sendgrid = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({ sent: true, provider: 'sendgrid', messageId: 'sg-1' }),
    };
    const smtp = {
      name: 'smtp',
      isConfigured: () => true,
      send: vi.fn(),
    };
    const service = new EmailService([sendgrid, smtp, consoleProvider]);
    const result = await service.send({
      to: 'guest@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(result.sent).toBe(true);
    expect(sendgrid.send).toHaveBeenCalled();
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it('passes stable transport identity through to the selected provider', async () => {
    const provider = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({ sent: true, messageId: 'provider-id' }),
    };
    const service = new EmailService([provider]);
    const message = {
      to: 'guest@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      idempotencyKey: 'booking-request-email:delivery-1',
      messageId: '<booking-request-email-delivery-1@haip.local>',
    };
    await service.send(message, { timeoutMs: 1_234 });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'booking-request-email:delivery-1',
      messageId: '<booking-request-email-delivery-1@haip.local>',
    }), { timeoutMs: 1_234 });
  });

  it('falls back to console when no real provider is configured', async () => {
    const smtp = { name: 'smtp', isConfigured: () => false, send: vi.fn() };
    const sendgrid = { name: 'sendgrid', isConfigured: () => false, send: vi.fn() };
    const service = new EmailService([sendgrid, smtp, consoleProvider]);
    expect(service.isConfigured()).toBe(false);
    await service.send({
      to: 'guest@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(consoleProvider.send).toHaveBeenCalled();
  });
});

describe('SendgridEmailProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('reports not configured without API key', async () => {
    delete process.env['SENDGRID_API_KEY'];
    delete process.env['SENDGRID_FROM'];
    const { SendgridEmailProvider } = await import('./providers/sendgrid-email.provider');
    const provider = new SendgridEmailProvider();
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.send({
      to: 'a@b.com',
      subject: 'S',
      html: 'h',
      text: 't',
    });
    expect(result.sent).toBe(false);
  });

  it('sends via SendGrid API when configured', async () => {
    process.env['SENDGRID_API_KEY'] = 'SG.test';
    process.env['SENDGRID_FROM'] = 'hotel@example.com';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'msg-123' },
    }) as any;

    const { SendgridEmailProvider } = await import('./providers/sendgrid-email.provider');
    const provider = new SendgridEmailProvider();
    expect(provider.isConfigured()).toBe(true);
    const result = await provider.send({
      to: 'guest@example.com',
      subject: 'Confirm',
      html: '<p>Hi</p>',
      text: 'Hi',
      idempotencyKey: 'stable-delivery-1',
      messageId: '<stable-delivery-1@haip.local>',
    });
    expect(result.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body));
    expect(payload.personalizations[0]).toMatchObject({
      headers: { 'Message-ID': '<stable-delivery-1@haip.local>' },
      custom_args: { haip_idempotency_key: 'stable-delivery-1' },
    });
  });

  it('aborts and awaits settlement of a bounded SendGrid request', async () => {
    vi.useFakeTimers();
    process.env['SENDGRID_API_KEY'] = 'SG.test';
    process.env['SENDGRID_FROM'] = 'hotel@example.com';
    let fetchSettled = false;
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        queueMicrotask(() => {
          fetchSettled = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }, { once: true });
    })) as any;

    const { SendgridEmailProvider } = await import('./providers/sendgrid-email.provider');
    const provider = new SendgridEmailProvider();
    const sending = provider.send({
      to: 'guest@example.com',
      subject: 'Confirm',
      html: '<p>Hi</p>',
      text: 'Hi',
    }, { timeoutMs: 100 });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(global.fetch).mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(100);
    await expect(sending).resolves.toMatchObject({
      sent: false,
      outcomeUnknown: true,
      error: 'Email transport timed out',
    });
    expect(signal?.aborted).toBe(true);
    expect(fetchSettled).toBe(true);
  });
});
