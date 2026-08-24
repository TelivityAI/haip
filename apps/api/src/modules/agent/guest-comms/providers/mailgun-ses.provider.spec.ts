import { describe, it, expect, vi, afterEach } from 'vitest';

describe('MailgunEmailProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('reports not configured without keys', async () => {
    delete process.env['MAILGUN_API_KEY'];
    delete process.env['MAILGUN_DOMAIN'];
    const { MailgunEmailProvider } = await import('./mailgun-email.provider');
    const provider = new MailgunEmailProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('sends via Mailgun when configured', async () => {
    process.env['MAILGUN_API_KEY'] = 'key';
    process.env['MAILGUN_DOMAIN'] = 'mg.example.com';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '<mailgun-1>' }),
    }) as any;

    const { MailgunEmailProvider } = await import('./mailgun-email.provider');
    const provider = new MailgunEmailProvider();
    const result = await provider.send({
      to: 'a@b.com',
      subject: 'S',
      html: 'h',
      text: 't',
      idempotencyKey: 'stable-delivery-1',
      messageId: '<stable-delivery-1@haip.local>',
    });
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('<mailgun-1>');
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('h:Message-Id')).toBe('<stable-delivery-1@haip.local>');
    expect(form.get('v:haip-idempotency-key')).toBe('stable-delivery-1');
  });

  it('aborts and awaits settlement of a bounded Mailgun request', async () => {
    vi.useFakeTimers();
    process.env['MAILGUN_API_KEY'] = 'key';
    process.env['MAILGUN_DOMAIN'] = 'mg.example.com';
    let settled = false;
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        queueMicrotask(() => {
          settled = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }, { once: true });
    })) as any;

    const { MailgunEmailProvider } = await import('./mailgun-email.provider');
    const provider = new MailgunEmailProvider();
    const sending = provider.send({
      to: 'a@b.com', subject: 'S', html: 'h', text: 't',
    }, { timeoutMs: 100 });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(global.fetch).mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(100);

    await expect(sending).resolves.toMatchObject({
      sent: false, outcomeUnknown: true, error: 'Email transport timed out',
    });
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(true);
  });

  it('keeps the bound active until the Mailgun response body settles', async () => {
    vi.useFakeTimers();
    process.env['MAILGUN_API_KEY'] = 'key';
    process.env['MAILGUN_DOMAIN'] = 'mg.example.com';
    let bodySettled = false;
    global.fetch = vi.fn((_url, init) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          queueMicrotask(() => {
            bodySettled = true;
            reject(Object.assign(new Error('aborted body'), { name: 'AbortError' }));
          });
        }, { once: true });
      }),
    })) as any;

    const { MailgunEmailProvider } = await import('./mailgun-email.provider');
    const provider = new MailgunEmailProvider();
    const sending = provider.send({
      to: 'a@b.com', subject: 'S', html: 'h', text: 't',
    }, { timeoutMs: 100 });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(global.fetch).mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(100);

    expect(signal?.aborted).toBe(true);
    await expect(sending).resolves.toMatchObject({
      sent: false, outcomeUnknown: true, error: 'Email transport timed out',
    });
    expect(bodySettled).toBe(true);
  });
});

describe('SesEmailProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('requires gateway env (honest path)', async () => {
    delete process.env['SES_ENDPOINT'];
    delete process.env['SES_API_KEY'];
    delete process.env['SES_FROM'];
    const { SesEmailProvider } = await import('./ses-email.provider');
    expect(new SesEmailProvider().isConfigured()).toBe(false);
  });

  it('sends via SES gateway when configured', async () => {
    process.env['SES_ENDPOINT'] = 'http://localhost:4566';
    process.env['SES_API_KEY'] = 'local';
    process.env['SES_FROM'] = 'noreply@example.com';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ MessageId: 'ses-1' }),
    }) as any;

    const { SesEmailProvider } = await import('./ses-email.provider');
    const provider = new SesEmailProvider();
    const result = await provider.send({
      to: 'a@b.com',
      subject: 'S',
      html: 'h',
      text: 't',
      idempotencyKey: 'stable-delivery-1',
      messageId: '<stable-delivery-1@haip.local>',
    });
    expect(result).toEqual({
      sent: true,
      provider: 'amazon-ses',
      messageId: 'ses-1',
    });
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      'X-HAIP-Idempotency-Key': 'stable-delivery-1',
    });
    const payload = JSON.parse(String(init?.body));
    expect(payload.Content.Simple.Headers).toContainEqual({
      Name: 'X-HAIP-Message-ID', Value: '<stable-delivery-1@haip.local>',
    });
    expect(payload.Content.Simple.Headers).not.toContainEqual(expect.objectContaining({
      Name: 'Message-ID',
    }));
  });

  it('aborts and awaits settlement of a bounded SES gateway request', async () => {
    vi.useFakeTimers();
    process.env['SES_ENDPOINT'] = 'http://localhost:4566';
    process.env['SES_API_KEY'] = 'local';
    process.env['SES_FROM'] = 'noreply@example.com';
    let settled = false;
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        queueMicrotask(() => {
          settled = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }, { once: true });
    })) as any;

    const { SesEmailProvider } = await import('./ses-email.provider');
    const provider = new SesEmailProvider();
    const sending = provider.send({
      to: 'a@b.com', subject: 'S', html: 'h', text: 't',
    }, { timeoutMs: 100 });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(global.fetch).mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(100);

    await expect(sending).resolves.toMatchObject({
      sent: false, outcomeUnknown: true, error: 'Email transport timed out',
    });
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(true);
  });
});
