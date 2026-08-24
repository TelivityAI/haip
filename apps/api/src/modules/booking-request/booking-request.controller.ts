import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  AuditActorCtx,
  type AuditActor,
} from '../../common/audit/audit-actor';
import { RequirePermissions } from '../auth/permissions.decorator';
import { BookingRequestService } from './booking-request.service';
// DTOs must remain runtime imports for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AcceptBookingRequestDto } from './dto/accept-booking-request.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DenyBookingRequestDto } from './dto/deny-booking-request.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ListBookingRequestsDto } from './dto/list-booking-requests.dto';

@ApiTags('booking-requests')
@Controller('booking-requests')
export class BookingRequestController {
  constructor(
    @Inject(BookingRequestService) private readonly service: BookingRequestService,
  ) {}

  @Get()
  @RequirePermissions('reservations.read')
  @ApiOperation({ summary: 'List property-scoped booking requests' })
  list(@Query() dto: ListBookingRequestsDto) {
    return this.service.list(dto);
  }

  @Get(':id')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Get a property-scoped booking request' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.service.findById(id, propertyId);
  }

  @Post(':id/accept')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Accept a request and create its reservation' })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AcceptBookingRequestDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.service.accept(id, propertyId, dto, actor);
  }

  @Post(':id/deny')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Deny a request after resolving captured money' })
  deny(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: DenyBookingRequestDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.service.deny(id, propertyId, dto, actor);
  }
}
