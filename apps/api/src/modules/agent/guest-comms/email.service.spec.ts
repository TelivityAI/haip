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
    });
    expect(result.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
