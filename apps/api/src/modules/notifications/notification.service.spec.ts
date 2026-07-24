import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { ConsoleTelegramProvider } from './providers/console-telegram.provider';
import type { SmsProvider, SmsResult, WhatsAppProvider } from './notification-provider.interface';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';

describe('NotificationService', () => {
  let webhooks: { emit: ReturnType<typeof vi.fn> };
  let consoleProvider: ConsoleSmsProvider;
  let consoleTelegram: ConsoleTelegramProvider;
  let consoleWhatsapp: WhatsAppProvider;
  let db: any;

  beforeEach(() => {
    webhooks = { emit: vi.fn().mockResolvedValue(undefined) };
    consoleProvider = new ConsoleSmsProvider();
    consoleTelegram = new ConsoleTelegramProvider();
    consoleWhatsapp = {
      name: 'console-whatsapp',
      isConfigured: () => true,
      send: vi.fn().mockResolvedValue({ sent: false, provider: 'console-whatsapp' }),
    };
    db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: 'res-1' }]),
            then: (resolve: (value: unknown) => void) => resolve([{ id: 'guest-1', gdprConsentMarketing: true }]),
          })),
        })),
      })),
    };
  });

  it('uses the injected console SMS provider', async () => {
    const service = new NotificationService(
      consoleProvider,
      consoleTelegram,
      [consoleWhatsapp],
      webhooks as any,
      db,
    );

    const result = await service.sendSms(PROPERTY_ID, '+15551230000', 'hello');

    expect(result.provider).toBe('console');
    expect(result.sent).toBe(false);
  });

  it('uses the injected SMS provider when configured', async () => {
    const sendSpy = vi.fn(
      async (): Promise<SmsResult> => ({ sent: true, provider: 'infobip', messageId: 'ib-1' }),
    );
    const infobip = { name: 'infobip', isConfigured: () => true, send: sendSpy } as SmsProvider;
    const service = new NotificationService(
      infobip,
      consoleTelegram,
      [consoleWhatsapp],
      webhooks as any,
      db,
    );

    const result = await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ sent: true, provider: 'infobip', messageId: 'ib-1' });
  });

  it('audits every dispatch scoped to the requesting property', async () => {
    const service = new NotificationService(
      consoleProvider,
      consoleTelegram,
      [consoleWhatsapp],
      webhooks as any,
      db,
    );

    await service.sendSms(PROPERTY_ID, '+15551230000', 'hey');

    expect(webhooks.emit).toHaveBeenCalledOnce();
    const [event, entityType, , data, propertyId] = webhooks.emit.mock.calls[0];
    expect(event).toBe('guest.communication_sent');
    expect(entityType).toBe('notification');
    expect(data).toMatchObject({ channel: 'sms', provider: 'console', success: false });
    expect(propertyId).toBe(PROPERTY_ID);
  });

  it('sends Telegram through the injected provider and audits', async () => {
    const send = vi.fn().mockResolvedValue({
      sent: true,
      provider: 'telegram',
      messageId: '99',
    });
    const telegram = { name: 'telegram', isConfigured: () => true, send };
    const service = new NotificationService(
      consoleProvider,
      telegram,
      [consoleWhatsapp],
      webhooks as any,
      db,
    );

    const result = await service.sendTelegram(PROPERTY_ID, '12345', 'hello');

    expect(send).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ sent: true, provider: 'telegram' });
    expect(webhooks.emit).toHaveBeenCalledWith(
      'guest.communication_sent',
      'notification',
      '12345',
      expect.objectContaining({ channel: 'telegram', provider: 'telegram', success: true }),
      PROPERTY_ID,
    );
  });

  describe('per-property SMS quota (toll-fraud / spam guard)', () => {
    const prev = process.env['SMS_RATE_LIMIT_MAX'];
    beforeEach(() => { process.env['SMS_RATE_LIMIT_MAX'] = '2'; });
    afterEach(() => {
      if (prev === undefined) delete process.env['SMS_RATE_LIMIT_MAX'];
      else process.env['SMS_RATE_LIMIT_MAX'] = prev;
    });

    it('throttles SMS for a property beyond the configured limit', async () => {
      const service = new NotificationService(
        consoleProvider,
        consoleTelegram,
        [consoleWhatsapp],
        webhooks as any,
        db,
      );
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await expect(service.sendSms(PROPERTY_ID, '+15551230000', 'hi')).rejects.toBeInstanceOf(HttpException);
    });

    it('still enforces with a default limit when the env value is invalid (no fail-open)', async () => {
      process.env['SMS_RATE_LIMIT_MAX'] = 'not-a-number';
      process.env['SMS_RATE_LIMIT_WINDOW_MS'] = 'garbage';
      const service = new NotificationService(
        consoleProvider,
        consoleTelegram,
        [consoleWhatsapp],
        webhooks as any,
        db,
      );
      // Default limit is 60 → the 61st send for one property must be throttled.
      for (let i = 0; i < 60; i++) await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await expect(service.sendSms(PROPERTY_ID, '+15551230000', 'hi')).rejects.toBeInstanceOf(HttpException);
      delete process.env['SMS_RATE_LIMIT_WINDOW_MS'];
    });

    it('treats an explicit 0 limit as disabled', async () => {
      process.env['SMS_RATE_LIMIT_MAX'] = '0';
      const service = new NotificationService(
        consoleProvider,
        consoleTelegram,
        [consoleWhatsapp],
        webhooks as any,
        db,
      );
      for (let i = 0; i < 5; i++) {
        await expect(service.sendSms(PROPERTY_ID, '+15551230000', 'hi')).resolves.toBeDefined();
      }
    });

    it('counts the quota independently per property', async () => {
      const service = new NotificationService(
        consoleProvider,
        consoleTelegram,
        [consoleWhatsapp],
        webhooks as any,
        db,
      );
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      // A different property still has quota.
      await expect(service.sendSms('22222222-2222-2222-2222-222222222222', '+15551230000', 'hi')).resolves.toBeDefined();
    });
  });

  describe('WhatsApp dispatch', () => {
    it('sends a transactional WhatsApp message through the active provider', async () => {
      const send = vi.fn().mockResolvedValue({
        sent: true,
        provider: 'twilio-whatsapp',
        messageId: 'WA123',
      });
      const whatsapp = {
        name: 'twilio-whatsapp',
        isConfigured: () => true,
        send,
      } as WhatsAppProvider;
      const service = new NotificationService(
        consoleProvider,
        consoleTelegram,
        [whatsapp],
        webhooks as any,
        db,
      );

      const result = await service.sendWhatsAppTemplate(PROPERTY_ID, {
        to: '+15551230000',
        contentSid: 'HX123',
        variables: { firstName: 'Alex' },
      });

      expect(send).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ sent: true, provider: 'twilio-whatsapp' });
    });

    it('rejects marketing WhatsApp messages when the guest lacks consent', async () => {
      const consentDb = {
        select: vi
          .fn()
          .mockImplementationOnce(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{ id: 'res-1' }]),
              })),
            })),
          }))
          .mockImplementationOnce(() => ({
            from: vi.fn(() => ({
              where: vi.fn().mockResolvedValue([{ id: 'guest-1', gdprConsentMarketing: false }]),
            })),
          })),
      };
      const service = new NotificationService(
        consoleProvider,
        consoleTelegram,
        [consoleWhatsapp],
        webhooks as any,
        consentDb,
      );

      await expect(
        service.sendWhatsAppTemplate(
          PROPERTY_ID,
          { to: '+15551230000', contentSid: 'HX123' },
          { guestId: 'guest-1', marketing: true },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
