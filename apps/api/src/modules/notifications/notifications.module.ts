import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { BirdSmsProvider } from './providers/bird-sms.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { ConsoleWhatsappProvider } from './providers/console-whatsapp.provider';
import { TwilioWhatsappProvider } from './providers/twilio-whatsapp.provider';
import { SMS_PROVIDERS, WHATSAPP_PROVIDERS } from './notification-provider.interface';

@Module({
  imports: [WebhookModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    TwilioSmsProvider,
    BirdSmsProvider,
    ConsoleSmsProvider,
    TwilioWhatsappProvider,
    ConsoleWhatsappProvider,
    {
      provide: SMS_PROVIDERS,
      inject: [TwilioSmsProvider, BirdSmsProvider, ConsoleSmsProvider],
      useFactory: (
        twilio: TwilioSmsProvider,
        bird: BirdSmsProvider,
        consoleProvider: ConsoleSmsProvider,
      ) => [twilio, bird, consoleProvider],
    },
    {
      provide: WHATSAPP_PROVIDERS,
      inject: [TwilioWhatsappProvider, ConsoleWhatsappProvider],
      useFactory: (
        twilio: TwilioWhatsappProvider,
        consoleProvider: ConsoleWhatsappProvider,
      ) => [twilio, consoleProvider],
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
