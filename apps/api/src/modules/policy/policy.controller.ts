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
import { PolicyService } from './policy.service';
import { CreateCancellationPolicyDto } from './dto/create-cancellation-policy.dto';
import { UpdateCancellationPolicyDto } from './dto/update-cancellation-policy.dto';
import { ListCancellationPoliciesDto } from './dto/list-cancellation-policies.dto';

@ApiTags('policy')
@Controller('cancellation-policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Post()
  @Roles('admin', 'front_desk')
  @RequirePermissions('policies.manage')
  @ApiOperation({ summary: 'Create a cancellation policy' })
  @ApiResponse({ status: 201, description: 'Policy created' })
  create(@Body() dto: CreateCancellationPolicyDto) {
    return this.policyService.create(dto);
  }

  @Get()
  @RequirePermissions('policies.read')
  @ApiOperation({ summary: 'List cancellation policies' })
  @ApiResponse({ status: 200, description: 'Paginated list of policies' })
  list(@Query() dto: ListCancellationPoliciesDto) {
    return this.policyService.list(dto);
  }

  @Get(':id')
  @RequirePermissions('policies.read')
  @ApiOperation({ summary: 'Get cancellation policy by ID' })
  @ApiResponse({ status: 200, description: 'Policy found' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.policyService.findById(id, propertyId);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk')
  @RequirePermissions('policies.manage')
  @ApiOperation({ summary: 'Update a cancellation policy' })
  @ApiResponse({ status: 200, description: 'Policy updated' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateCancellationPolicyDto,
  ) {
    return this.policyService.update(id, propertyId, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @RequirePermissions('policies.manage')
  @ApiOperation({ summary: 'Deactivate a cancellation policy' })
  @ApiResponse({ status: 200, description: 'Policy deactivated' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.policyService.softDelete(id, propertyId);
  }
}
