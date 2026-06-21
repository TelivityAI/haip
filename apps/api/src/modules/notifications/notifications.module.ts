import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';

@Module({
  imports: [WebhookModule],
  controllers: [NotificationsController],
  providers: [NotificationService, TwilioSmsProvider, ConsoleSmsProvider],
  exports: [NotificationService],
})
export class NotificationsModule {}
