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
    expect(result.status).toBe('sent');
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('<mailgun-1>');
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('h:Message-Id')).toBe('<stable-delivery-1@haip.local>');
    expect(form.get('v:haip-idempotency-key')).toBe('stable-delivery-1');
  });

  it('returns at the hard HTTP deadline even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    process.env['MAILGUN_API_KEY'] = 'key';
    process.env['MAILGUN_DOMAIN'] = 'mg.example.com';
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, _reject) => {
      init?.signal?.addEventListener('abort', () => undefined, { once: true });
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
      status: 'outcomeUnknown',
      sent: false,
      error: 'Email transport timed out',
    });
    expect(signal?.aborted).toBe(true);
  });

  it('swallows detached body rejection after the hard deadline', async () => {
    vi.useFakeTimers();
    process.env['MAILGUN_API_KEY'] = 'key';
    process.env['MAILGUN_DOMAIN'] = 'mg.example.com';
    global.fetch = vi.fn((_url, init) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          queueMicrotask(() => reject(Object.assign(new Error('aborted body'), { name: 'AbortError' })));
        }, { once: true });
      }),
    })) as any;

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const { MailgunEmailProvider } = await import('./mailgun-email.provider');
    const provider = new MailgunEmailProvider();
    const sending = provider.send({
      to: 'a@b.com', subject: 'S', html: 'h', text: 't',
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
      status: 'sent',
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
  });

  it('returns at the hard HTTP deadline even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    process.env['SES_ENDPOINT'] = 'http://localhost:4566';
    process.env['SES_API_KEY'] = 'local';
    process.env['SES_FROM'] = 'noreply@example.com';
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, _reject) => {
      init?.signal?.addEventListener('abort', () => undefined, { once: true });
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
      status: 'outcomeUnknown',
      sent: false,
      error: 'Email transport timed out',
    });
    expect(signal?.aborted).toBe(true);
  });
});
