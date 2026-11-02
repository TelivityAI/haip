import { describe, it, expect, vi, afterEach } from 'vitest';

describe('SendgridEmailProvider branding', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('sends named From and reply_to', async () => {
    process.env['SENDGRID_API_KEY'] = 'sg-key';
    process.env['SENDGRID_FROM'] = 'noreply@haip.dev';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'sg-msg-1' },
      text: async () => '',
    }) as any;

    const { SendgridEmailProvider } = await import('./sendgrid-email.provider');
    const provider = new SendgridEmailProvider();
    const result = await provider.send({
      to: 'guest@example.com',
      subject: 'Stay',
      html: '<p>Hi</p>',
      text: 'Hi',
      from: '"Demo Hotel" <noreply@haip.dev>',
      replyTo: 'info@hotel.example',
    });

    expect(result.status).toBe('sent');
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.from).toEqual({ email: 'noreply@haip.dev', name: 'Demo Hotel' });
    expect(body.reply_to).toEqual({ email: 'info@hotel.example' });
  });

  it('omits reply_to when not provided', async () => {
    process.env['SENDGRID_API_KEY'] = 'sg-key';
    process.env['SENDGRID_FROM'] = 'noreply@haip.dev';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: async () => '',
    }) as any;

    const { SendgridEmailProvider } = await import('./sendgrid-email.provider');
    const provider = new SendgridEmailProvider();
    await provider.send({
      to: 'guest@example.com',
      subject: 'Stay',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body));
    expect(body.reply_to).toBeUndefined();
    expect(body.from).toEqual({ email: 'noreply@haip.dev' });
  });
});
