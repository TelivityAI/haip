import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AncillaryService } from './ancillary.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import { CreateRatePlanComponentDto } from './dto/create-rate-plan-component.dto';
import { AttachReservationServiceDto } from './dto/attach-reservation-service.dto';

@ApiTags('ancillary')
@Controller('ancillary')
export class AncillaryController {
  constructor(private readonly ancillaryService: AncillaryService) {}

  // --- Catalog services ---

  @Post('services')
  @Roles('admin', 'front_desk')
  @RequirePermissions('services.manage')
  @ApiOperation({ summary: 'Create a sellable stay service' })
  @ApiResponse({ status: 201, description: 'Service created' })
  createService(@Body() dto: CreateServiceDto) {
    return this.ancillaryService.createService(dto);
  }

  @Get('services')
  @RequirePermissions('services.read')
  @ApiOperation({ summary: 'List sellable stay services' })
  @ApiResponse({ status: 200, description: 'Paginated list of services' })
  listServices(@Query() dto: ListServicesDto) {
    return this.ancillaryService.listServices(dto);
  }

  @Get('services/:id')
  @RequirePermissions('services.read')
  @ApiOperation({ summary: 'Get service by ID' })
  @ApiResponse({ status: 200, description: 'Service found' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  getService(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ancillaryService.findServiceById(id, propertyId);
  }

  @Patch('services/:id')
  @Roles('admin', 'front_desk')
  @RequirePermissions('services.manage')
  @ApiOperation({ summary: 'Update a service' })
  @ApiResponse({ status: 200, description: 'Service updated' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.ancillaryService.updateService(id, propertyId, dto);
  }

  // --- Rate plan components ---

  @Post('rate-plan-components')
  @Roles('admin', 'front_desk')
  @RequirePermissions('services.manage')
  @ApiOperation({ summary: 'Link a service to a rate plan (package component)' })
  @ApiResponse({ status: 201, description: 'Component created' })
  createRatePlanComponent(@Body() dto: CreateRatePlanComponentDto) {
    return this.ancillaryService.createRatePlanComponent(dto);
  }

  @Get('rate-plan-components')
  @RequirePermissions('services.read')
  @ApiOperation({ summary: 'List rate plan components' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiQuery({ name: 'ratePlanId', type: String, required: true })
  listRatePlanComponents(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('ratePlanId', ParseUUIDPipe) ratePlanId: string,
  ) {
    return this.ancillaryService.listRatePlanComponents(propertyId, ratePlanId);
  }

  @Delete('rate-plan-components/:id')
  @Roles('admin', 'front_desk')
  @RequirePermissions('services.manage')
  @ApiOperation({ summary: 'Delete a rate plan component' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  deleteRatePlanComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ancillaryService.deleteRatePlanComponent(id, propertyId);
  }

  // --- Reservation services ---

  @Post('reservations/:reservationId/services')
  @Roles('admin', 'front_desk')
  @RequirePermissions('reservations.write')
  @ApiOperation({ summary: 'Attach a service to a reservation' })
  @ApiResponse({ status: 201, description: 'Service attached' })
  attachToReservation(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: AttachReservationServiceDto,
  ) {
    return this.ancillaryService.attachToReservation(reservationId, dto);
  }

  @Get('reservations/:reservationId/services')
  @RequirePermissions('reservations.read')
  @ApiOperation({ summary: 'List services attached to a reservation' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  listForReservation(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ancillaryService.listForReservation(propertyId, reservationId);
  }

  @Post('reservations/:reservationId/services/:id/cancel')
  @Roles('admin', 'front_desk')
  @RequirePermissions('reservations.write')
  @ApiOperation({ summary: 'Cancel an attached reservation service' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  cancelReservationService(
    @Param('reservationId', ParseUUIDPipe) _reservationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ancillaryService.cancelReservationService(id, propertyId);
  }

  @Post('reservations/:reservationId/post-once')
  @Roles('admin', 'front_desk')
  @RequirePermissions('folios.manage')
  @ApiOperation({ summary: 'Post once / included_in_rate services to the guest folio' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  postOnce(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ancillaryService.postOnceForReservation(reservationId, propertyId);
  }
}
