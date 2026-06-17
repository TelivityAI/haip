import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
