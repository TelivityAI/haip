import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import type { SmsResult } from './notification-provider.interface';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';

describe('NotificationService', () => {
  let webhooks: { emit: ReturnType<typeof vi.fn> };
  let consoleProvider: ConsoleSmsProvider;

  beforeEach(() => {
    webhooks = { emit: vi.fn().mockResolvedValue(undefined) };
    consoleProvider = new ConsoleSmsProvider();
  });

  it('falls back to the console provider when Twilio is not configured', async () => {
    const twilio = { isConfigured: () => false } as unknown as TwilioSmsProvider;
    const service = new NotificationService(twilio, consoleProvider, webhooks as any);

    const result = await service.sendSms(PROPERTY_ID, '+15551230000', 'hello');

    expect(result.provider).toBe('console');
    expect(result.sent).toBe(false);
  });

  it('uses Twilio when it is configured', async () => {
    const sendSpy = vi.fn(
      async (): Promise<SmsResult> => ({ sent: true, provider: 'twilio', messageId: 'SM123' }),
    );
    const twilio = { isConfigured: () => true, send: sendSpy } as unknown as TwilioSmsProvider;
    const service = new NotificationService(twilio, consoleProvider, webhooks as any);

    const result = await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ sent: true, provider: 'twilio', messageId: 'SM123' });
  });

  it('audits every dispatch scoped to the requesting property', async () => {
    const twilio = { isConfigured: () => false } as unknown as TwilioSmsProvider;
    const service = new NotificationService(twilio, consoleProvider, webhooks as any);

    await service.sendSms(PROPERTY_ID, '+15551230000', 'hey');

    expect(webhooks.emit).toHaveBeenCalledOnce();
    const [event, entityType, , data, propertyId] = webhooks.emit.mock.calls[0];
    expect(event).toBe('guest.communication_sent');
    expect(entityType).toBe('notification');
    expect(data).toMatchObject({ channel: 'sms', provider: 'console', success: false });
    expect(propertyId).toBe(PROPERTY_ID);
  });

  describe('per-property SMS quota (toll-fraud / spam guard)', () => {
    const prev = process.env['SMS_RATE_LIMIT_MAX'];
    beforeEach(() => { process.env['SMS_RATE_LIMIT_MAX'] = '2'; });
    afterEach(() => {
      if (prev === undefined) delete process.env['SMS_RATE_LIMIT_MAX'];
      else process.env['SMS_RATE_LIMIT_MAX'] = prev;
    });

    it('throttles SMS for a property beyond the configured limit', async () => {
      const twilio = { isConfigured: () => false } as unknown as TwilioSmsProvider;
      const service = new NotificationService(twilio, consoleProvider, webhooks as any);
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await expect(service.sendSms(PROPERTY_ID, '+15551230000', 'hi')).rejects.toBeInstanceOf(HttpException);
    });

    it('still enforces with a default limit when the env value is invalid (no fail-open)', async () => {
      process.env['SMS_RATE_LIMIT_MAX'] = 'not-a-number';
      process.env['SMS_RATE_LIMIT_WINDOW_MS'] = 'garbage';
      const twilio = { isConfigured: () => false } as unknown as TwilioSmsProvider;
      const service = new NotificationService(twilio, consoleProvider, webhooks as any);
      // Default limit is 60 → the 61st send for one property must be throttled.
      for (let i = 0; i < 60; i++) await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await expect(service.sendSms(PROPERTY_ID, '+15551230000', 'hi')).rejects.toBeInstanceOf(HttpException);
      delete process.env['SMS_RATE_LIMIT_WINDOW_MS'];
    });

    it('treats an explicit 0 limit as disabled', async () => {
      process.env['SMS_RATE_LIMIT_MAX'] = '0';
      const twilio = { isConfigured: () => false } as unknown as TwilioSmsProvider;
      const service = new NotificationService(twilio, consoleProvider, webhooks as any);
      for (let i = 0; i < 5; i++) {
        await expect(service.sendSms(PROPERTY_ID, '+15551230000', 'hi')).resolves.toBeDefined();
      }
    });

    it('counts the quota independently per property', async () => {
      const twilio = { isConfigured: () => false } as unknown as TwilioSmsProvider;
      const service = new NotificationService(twilio, consoleProvider, webhooks as any);
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      await service.sendSms(PROPERTY_ID, '+15551230000', 'hi');
      // A different property still has quota.
      await expect(service.sendSms('22222222-2222-2222-2222-222222222222', '+15551230000', 'hi')).resolves.toBeDefined();
    });
  });
});
