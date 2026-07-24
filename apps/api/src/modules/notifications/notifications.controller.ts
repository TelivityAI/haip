import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { NotificationService } from './notification.service';
import { SendSmsDto } from './dto/send-sms.dto';
import { SendWhatsAppDto } from './dto/send-whatsapp.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('sms')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Send an SMS to a guest via the configured provider' })
  @ApiResponse({ status: 201, description: 'Dispatch result (sent flag + provider + messageId/error)' })
  sendSms(@Body() dto: SendSmsDto) {
    return this.notificationService.sendSms(dto.propertyId, dto.to, dto.body);
  }

  @Post('whatsapp')
  @Roles('admin', 'front_desk', 'night_auditor')
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
}
