import { describe, it, expect, vi, afterEach } from 'vitest';

describe('MailgunEmailProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
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
    });
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('<mailgun-1>');
  });
});

describe('SesEmailProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
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
    });
    expect(result).toEqual({
      sent: true,
      provider: 'amazon-ses',
      messageId: 'ses-1',
    });
  });
});
