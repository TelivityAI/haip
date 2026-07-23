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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ServiceRequestsService } from './service-requests.service';
import {
  CreateServiceRequestDto,
  UpdateServiceRequestDto,
  ListServiceRequestsDto,
  CreateTaskFromRequestDto,
} from './dto/service-request.dto';

@ApiTags('service-requests')
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly serviceRequestsService: ServiceRequestsService) {}

  @Post()
  @Roles('admin', 'front_desk', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Create a service request' })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateServiceRequestDto) {
    return this.serviceRequestsService.create(dto);
  }

  @Get()
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'List service requests' })
  list(@Query() dto: ListServiceRequestsDto) {
    return this.serviceRequestsService.list(dto);
  }

  @Get(':id')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'Get service request by ID' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.serviceRequestsService.findById(id, propertyId);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Update service request' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateServiceRequestDto,
  ) {
    return this.serviceRequestsService.update(id, propertyId, dto);
  }

  @Post(':id/create-task')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Create a linked housekeeping task from a service request' })
  createTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskFromRequestDto,
  ) {
    return this.serviceRequestsService.createLinkedTask(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Delete service request' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.serviceRequestsService.delete(id, propertyId);
  }
}
