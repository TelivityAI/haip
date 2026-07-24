import { Module } from '@nestjs/common';
import { EMAIL_PROVIDERS } from './email-provider.interface';
import { EmailService } from './email.service';
import { SendgridEmailProvider } from './providers/sendgrid-email.provider';
import { MailgunEmailProvider } from './providers/mailgun-email.provider';
import { SesEmailProvider } from './providers/ses-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { ConsoleEmailProvider } from './providers/console-email.provider';

@Module({
  providers: [
    SendgridEmailProvider,
    MailgunEmailProvider,
    SesEmailProvider,
    SmtpEmailProvider,
    ConsoleEmailProvider,
    {
      provide: EMAIL_PROVIDERS,
      inject: [
        SendgridEmailProvider,
        MailgunEmailProvider,
        SesEmailProvider,
        SmtpEmailProvider,
        ConsoleEmailProvider,
      ],
      useFactory: (
        sendgrid: SendgridEmailProvider,
        mailgun: MailgunEmailProvider,
        ses: SesEmailProvider,
        smtp: SmtpEmailProvider,
        consoleProvider: ConsoleEmailProvider,
      ) => [sendgrid, mailgun, ses, smtp, consoleProvider],
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
