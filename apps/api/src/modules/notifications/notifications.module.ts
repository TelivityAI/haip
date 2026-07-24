import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { NotificationProviderFactory } from './notification-provider.factory';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { BirdSmsProvider } from './providers/bird-sms.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { InfobipSmsProvider } from './providers/infobip-sms.provider';
import { VonageSmsProvider } from './providers/vonage-sms.provider';
import { ConsoleWhatsappProvider } from './providers/console-whatsapp.provider';
import { TwilioWhatsappProvider } from './providers/twilio-whatsapp.provider';
import { WhatsappCloudProvider } from './providers/whatsapp-cloud.provider';
import { TelegramBotProvider } from './providers/telegram-bot.provider';
import { ConsoleTelegramProvider } from './providers/console-telegram.provider';
import {
  SMS_PROVIDER,
  SMS_PROVIDERS,
  TELEGRAM_PROVIDER,
  TELEGRAM_PROVIDERS,
  WHATSAPP_PROVIDERS,
} from './notification-provider.interface';

@Module({
  imports: [WebhookModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    NotificationProviderFactory,
    TwilioSmsProvider,
    BirdSmsProvider,
    ConsoleSmsProvider,
    InfobipSmsProvider,
    VonageSmsProvider,
    WhatsappCloudProvider,
    TwilioWhatsappProvider,
    ConsoleWhatsappProvider,
    TelegramBotProvider,
    ConsoleTelegramProvider,
    {
      provide: SMS_PROVIDERS,
      inject: [
        TwilioSmsProvider,
        InfobipSmsProvider,
        VonageSmsProvider,
        BirdSmsProvider,
        ConsoleSmsProvider,
      ],
      useFactory: (
        twilio: TwilioSmsProvider,
        infobip: InfobipSmsProvider,
        vonage: VonageSmsProvider,
        bird: BirdSmsProvider,
        consoleProvider: ConsoleSmsProvider,
      ) => [twilio, infobip, vonage, bird, consoleProvider],
    },
    {
      provide: SMS_PROVIDER,
      inject: [NotificationProviderFactory],
      useFactory: (factory: NotificationProviderFactory) => factory.resolveSms(),
    },
    {
      provide: TELEGRAM_PROVIDERS,
      inject: [TelegramBotProvider, ConsoleTelegramProvider],
      useFactory: (telegram: TelegramBotProvider, consoleProvider: ConsoleTelegramProvider) => [
        telegram,
        consoleProvider,
      ],
    },
    {
      provide: TELEGRAM_PROVIDER,
      inject: [NotificationProviderFactory],
      useFactory: (factory: NotificationProviderFactory) => factory.resolveTelegram(),
    },
    {
      provide: WHATSAPP_PROVIDERS,
      inject: [WhatsappCloudProvider, TwilioWhatsappProvider, ConsoleWhatsappProvider],
      useFactory: (
        cloud: WhatsappCloudProvider,
        twilio: TwilioWhatsappProvider,
        consoleProvider: ConsoleWhatsappProvider,
      ) => [cloud, twilio, consoleProvider],
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
