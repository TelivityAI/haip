import { Controller, Get, Patch, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { StaffNotificationService } from './staff-notification.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@ApiTags('staff-notifications')
@Controller('staff-notifications')
export class StaffNotificationController {
  constructor(private readonly service: StaffNotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List staff notifications for current user at a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  list(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const userId = user?.sub ?? 'anonymous';
    return this.service.listForUser(propertyId, userId);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  @ApiQuery({ name: 'propertyId', required: true })
  async unreadCount(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const userId = user?.sub ?? 'anonymous';
    const count = await this.service.unreadCount(propertyId, userId);
    return { count };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiQuery({ name: 'propertyId', required: true })
  markAllRead(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const userId = user?.sub ?? 'anonymous';
    return this.service.markAllRead(propertyId, userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiQuery({ name: 'propertyId', required: true })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const userId = user?.sub ?? 'anonymous';
    return this.service.markRead(id, propertyId, userId);
  }
}
