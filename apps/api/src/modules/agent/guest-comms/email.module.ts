import { Module } from '@nestjs/common';
import { EMAIL_PROVIDERS } from './email-provider.interface';
import { EmailService } from './email.service';
import { SendgridEmailProvider } from './providers/sendgrid-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { ConsoleEmailProvider } from './providers/console-email.provider';

@Module({
  providers: [
    SendgridEmailProvider,
    SmtpEmailProvider,
    ConsoleEmailProvider,
    {
      provide: EMAIL_PROVIDERS,
      inject: [SendgridEmailProvider, SmtpEmailProvider, ConsoleEmailProvider],
      useFactory: (
        sendgrid: SendgridEmailProvider,
        smtp: SmtpEmailProvider,
        consoleProvider: ConsoleEmailProvider,
      ) => [sendgrid, smtp, consoleProvider],
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
