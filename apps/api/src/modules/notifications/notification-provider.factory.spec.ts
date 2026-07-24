import { describe, it, expect, afterEach, vi } from 'vitest';
import { NotificationProviderFactory } from './notification-provider.factory';
import type { SmsProvider, TelegramProvider } from './notification-provider.interface';

function stubSms(name: string, configured: boolean): SmsProvider {
  return {
    name,
    isConfigured: () => configured,
    send: vi.fn(),
  };
}

function stubTelegram(name: string, configured: boolean): TelegramProvider {
  return {
    name,
    isConfigured: () => configured,
    send: vi.fn(),
  };
}

describe('NotificationProviderFactory', () => {
  const prevSms = process.env['SMS_PROVIDER'];
  const prevTelegram = process.env['TELEGRAM_PROVIDER'];

  afterEach(() => {
    if (prevSms === undefined) delete process.env['SMS_PROVIDER'];
    else process.env['SMS_PROVIDER'] = prevSms;
    if (prevTelegram === undefined) delete process.env['TELEGRAM_PROVIDER'];
    else process.env['TELEGRAM_PROVIDER'] = prevTelegram;
  });

  it('auto-selects the first configured SMS vendor when SMS_PROVIDER is unset', () => {
    delete process.env['SMS_PROVIDER'];
    const twilio = stubSms('twilio', false);
    const infobip = stubSms('infobip', true);
    const consoleProvider = stubSms('console', true);
    const factory = new NotificationProviderFactory(
      [twilio, infobip, consoleProvider],
      [stubTelegram('console', true)],
    );
    expect(factory.resolveSms()).toBe(infobip);
  });

  it('selects vonage when SMS_PROVIDER=vonage and configured', () => {
    process.env['SMS_PROVIDER'] = 'vonage';
    const vonage = stubSms('vonage', true);
    const consoleProvider = stubSms('console', true);
    const factory = new NotificationProviderFactory(
      [vonage, consoleProvider],
      [stubTelegram('console', true)],
    );
    expect(factory.resolveSms()).toBe(vonage);
  });

  it('falls back to console when explicit SMS provider is not configured', () => {
    process.env['SMS_PROVIDER'] = 'infobip';
    const infobip = stubSms('infobip', false);
    const consoleProvider = stubSms('console', true);
    const factory = new NotificationProviderFactory(
      [infobip, consoleProvider],
      [stubTelegram('console', true)],
    );
    expect(factory.resolveSms()).toBe(consoleProvider);
  });

  it('selects telegram bot when configured', () => {
    delete process.env['TELEGRAM_PROVIDER'];
    const telegram = stubTelegram('telegram', true);
    const consoleTelegram = stubTelegram('console', true);
    const factory = new NotificationProviderFactory([stubSms('console', true)], [telegram, consoleTelegram]);
    expect(factory.resolveTelegram()).toBe(telegram);
  });

  it('falls back to console telegram when bot token missing', () => {
    process.env['TELEGRAM_PROVIDER'] = 'telegram';
    const telegram = stubTelegram('telegram', false);
    const consoleTelegram = stubTelegram('console', true);
    const factory = new NotificationProviderFactory([stubSms('console', true)], [telegram, consoleTelegram]);
    expect(factory.resolveTelegram()).toBe(consoleTelegram);
  });
});
