import { Controller, Post, Get, Patch, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AuditActorCtx, type AuditActor } from '../../common/audit/audit-actor';
import { NotificationService } from './notification.service';
import { EmailTemplatesService } from './email-templates.service';
import { SendSmsDto } from './dto/send-sms.dto';
import { SendWhatsAppDto } from './dto/send-whatsapp.dto';
import { SendTelegramDto } from './dto/send-telegram.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly emailTemplates: EmailTemplatesService,
  ) {}

  @Post('sms')
  @RequirePermissions('communications.manage')
  @ApiOperation({ summary: 'Send an SMS to a guest via the configured provider' })
  @ApiResponse({ status: 201, description: 'Dispatch result (sent flag + provider + messageId/error)' })
  sendSms(@Body() dto: SendSmsDto) {
    return this.notificationService.sendSms(dto.propertyId, dto.to, dto.body);
  }

  @Post('whatsapp')
  @RequirePermissions('communications.manage')
  @ApiOperation({ summary: 'Send a WhatsApp template/body via the configured provider' })
  @ApiResponse({ status: 201, description: 'Dispatch result (sent flag + provider + messageId/error)' })
  sendWhatsApp(@Body() dto: SendWhatsAppDto) {
    return this.notificationService.sendWhatsAppTemplate(
      dto.propertyId,
      {
        to: dto.to,
        contentSid: dto.contentSid,
        body: dto.body,
        variables: dto.variables,
      },
      {
        guestId: dto.guestId,
        marketing: dto.marketing,
      },
    );
  }

  @Post('telegram')
  @RequirePermissions('communications.manage')
  @ApiOperation({ summary: 'Send a Telegram message to a guest via the configured bot' })
  @ApiResponse({ status: 201, description: 'Dispatch result (sent flag + provider + messageId/error)' })
  sendTelegram(@Body() dto: SendTelegramDto) {
    return this.notificationService.sendTelegram(dto.propertyId, dto.to, dto.body, {
      parseMode: dto.parseMode,
    });
  }

  // ---- Lifecycle email templates ----

  @Get('email-templates')
  @RequirePermissions('communications.manage')
  @ApiOperation({
    summary: 'List lifecycle email templates (defaults + this property’s overrides)',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  listEmailTemplates(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.emailTemplates.list(propertyId);
  }

  @Patch('email-templates/:emailType')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'Override one lifecycle email (subject / first-time body / repeat body / enabled)',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  updateEmailTemplate(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('emailType') emailType: string,
    @Body() dto: UpdateEmailTemplateDto,
    @AuditActorCtx() actor?: AuditActor,
  ) {
    return this.emailTemplates.update(propertyId, emailType, dto, actor);
  }
}
