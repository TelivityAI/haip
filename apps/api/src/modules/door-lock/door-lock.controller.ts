import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { DoorLockService } from './door-lock.service';
import { ListDoorLockCredentialsDto } from './dto/list-credentials.dto';

@ApiTags('door-lock')
@Controller('door-lock')
export class DoorLockController {
  constructor(private readonly doorLockService: DoorLockService) {}

  @Get('credentials')
  @RequirePermissions('frontdesk.access')
  @ApiOperation({ summary: 'List door-lock credentials for a property' })
  @ApiResponse({ status: 200, description: 'Paginated credential list' })
  list(@Query() dto: ListDoorLockCredentialsDto) {
    return this.doorLockService.list(dto);
  }

  @Get('credentials/:reservationId')
  @RequirePermissions('frontdesk.access')
  @ApiOperation({ summary: 'Get door-lock credential for a reservation' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Credential found' })
  @ApiResponse({ status: 404, description: 'Credential not found' })
  getByReservation(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.doorLockService.findByReservation(reservationId, propertyId);
  }

  @Post('credentials/:reservationId/reissue')
  @Roles('admin', 'front_desk')
  @RequirePermissions('frontdesk.access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reissue door-lock PIN for a reservation' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Credential reissued' })
  reissue(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.doorLockService.reissue(reservationId, propertyId);
  }
}
