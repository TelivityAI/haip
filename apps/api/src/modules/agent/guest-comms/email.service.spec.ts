import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from './email.service';
import type { EmailProvider, EmailResult } from './email-provider.interface';

describe('EmailService', () => {
  const consoleProvider: EmailProvider = {
    name: 'console',
    isConfigured: () => true,
    send: vi.fn().mockResolvedValue({
      status: 'notSent',
      sent: false,
      provider: 'console',
      error: 'logged',
    } satisfies EmailResult),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers SendGrid over SMTP when both configured', async () => {
    const sendgrid = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({
        status: 'sent',
        sent: true,
        provider: 'sendgrid',
        messageId: 'sg-1',
      } satisfies EmailResult),
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
    expect(result.status).toBe('sent');
    expect(sendgrid.send).toHaveBeenCalledTimes(1);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it('passes stable transport identity through to the selected provider', async () => {
    const provider = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({
        status: 'sent',
        sent: true,
        messageId: 'provider-id',
      } satisfies EmailResult),
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

  it('retries definitely-not-sent failures but not outcomeUnknown', async () => {
    const provider = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn()
        .mockResolvedValueOnce({
          status: 'notSent',
          sent: false,
          provider: 'sendgrid',
          error: 'SendGrid HTTP 503',
        } satisfies EmailResult)
        .mockResolvedValueOnce({
          status: 'outcomeUnknown',
          sent: false,
          provider: 'sendgrid',
          error: 'Email transport timed out',
        } satisfies EmailResult),
    };
    const service = new EmailService([provider]);
    const message = {
      to: 'guest@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      idempotencyKey: 'delivery-1',
      messageId: '<delivery-1@haip.local>',
    };

    const result = await service.send(message, { maxAttempts: 3 });
    expect(result.status).toBe('outcomeUnknown');
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('does not retry outcomeUnknown on the first attempt', async () => {
    const provider = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({
        status: 'outcomeUnknown',
        sent: false,
        provider: 'sendgrid',
        error: 'Email transport timed out',
      } satisfies EmailResult),
    };
    const service = new EmailService([provider]);
    const result = await service.send({
      to: 'guest@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    }, { maxAttempts: 3 });
    expect(result.status).toBe('outcomeUnknown');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxAttempts for notSent then stops', async () => {
    vi.useFakeTimers();
    const provider = {
      name: 'sendgrid',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({
        status: 'notSent',
        sent: false,
        provider: 'sendgrid',
        error: 'SendGrid HTTP 503',
      } satisfies EmailResult),
    };
    const service = new EmailService([provider]);
    const sending = service.send({
      to: 'guest@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    }, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    const result = await sending;
    expect(result.status).toBe('notSent');
    expect(provider.send).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
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
    expect(result.status).toBe('notSent');
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
    expect(result.status).toBe('sent');
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

  it('returns at the hard HTTP deadline even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    process.env['SENDGRID_API_KEY'] = 'SG.test';
    process.env['SENDGRID_FROM'] = 'hotel@example.com';
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, _reject) => {
      init?.signal?.addEventListener('abort', () => undefined, { once: true });
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
      status: 'outcomeUnknown',
      sent: false,
      error: 'Email transport timed out',
    });
    expect(signal?.aborted).toBe(true);
  });

  it('swallows detached fetch rejection after the hard deadline', async () => {
    vi.useFakeTimers();
    process.env['SENDGRID_API_KEY'] = 'SG.test';
    process.env['SENDGRID_FROM'] = 'hotel@example.com';
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        queueMicrotask(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }, { once: true });
    })) as any;

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const { SendgridEmailProvider } = await import('./providers/sendgrid-email.provider');
    const provider = new SendgridEmailProvider();
    const sending = provider.send({
      to: 'guest@example.com',
      subject: 'Confirm',
      html: '<p>Hi</p>',
      text: 'Hi',
    }, { timeoutMs: 100 });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(100);
    await expect(sending).resolves.toMatchObject({ status: 'outcomeUnknown' });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(unhandled).toEqual([]);
    process.off('unhandledRejection', onUnhandled);
  });
});

describe('boundedEmailFetch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it('returns at timeout without waiting for a hanging response body', async () => {
    vi.useFakeTimers();
    let bodySettled = false;
    global.fetch = vi.fn((_url, init) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, _reject) => {
        init?.signal?.addEventListener('abort', () => undefined, { once: true });
      }),
    })) as any;

    const { boundedEmailFetch, EmailTransportTimeoutError } = await import('./providers/bounded-email-transport');
    const work = boundedEmailFetch(
      'https://example.test/send',
      { method: 'POST' },
      { timeoutMs: 100 },
      async (response) => {
        await response.json();
        bodySettled = true;
        return 'done';
      },
    );
    const expectation = expect(work).rejects.toBeInstanceOf(EmailTransportTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(bodySettled).toBe(false);
  });
});
