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
import { RequirePermissions } from '../auth/permissions.decorator';
import { RatePlanService } from './rate-plan.service';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { CreateRateRestrictionDto } from './dto/create-rate-restriction.dto';
import { UpdateRateRestrictionDto } from './dto/update-rate-restriction.dto';
import { EffectiveRateQueryDto } from './dto/effective-rate-query.dto';
import { resolvePropertyId } from '../../common/property-id';

@ApiTags('rate-plans')
@Controller('rate-plans')
export class RatePlanController {
  constructor(private readonly ratePlanService: RatePlanService) {}

  @Get()
  @RequirePermissions('rateplans.read')
  @ApiOperation({ summary: 'Get all rate plans for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'List of rate plans' })
  getAllRatePlans(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.ratePlanService.findAll(propertyId);
  }

  @Post()
  @RequirePermissions('rateplans.manage')
  @ApiOperation({
    summary: 'Create new rate plan',
    description:
      'propertyId may be sent in the JSON body (preferred) or as ?propertyId= when omitted from the body. If both are sent they must match.',
  })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Alias when body omits propertyId',
  })
  @ApiResponse({ status: 201, description: 'Rate plan created' })
  createRatePlan(
    @Body() dto: CreateRatePlanDto,
    @Query('propertyId', new ParseUUIDPipe({ optional: true })) queryPropertyId?: string,
  ) {
    dto.propertyId = resolvePropertyId({ body: dto.propertyId, query: queryPropertyId });
    return this.ratePlanService.create(dto as CreateRatePlanDto & { propertyId: string });
  }

  @Get(':id')
  @RequirePermissions('rateplans.read')
  @ApiOperation({ summary: 'Get rate plan by ID' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Rate plan found' })
  @ApiResponse({ status: 404, description: 'Rate plan not found' })
  getRatePlanById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ratePlanService.findById(id, propertyId);
  }

  @Get(':id/effective-rate')
  @RequirePermissions('rateplans.read')
  @ApiOperation({
    summary: 'Calculate effective rate (derived chain + LOS + occupancy adjustments)',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'nights', required: false, description: 'Length of stay in nights' })
  @ApiQuery({ name: 'checkIn', required: false, description: 'Arrival date (ISO)' })
  @ApiQuery({ name: 'checkOut', required: false, description: 'Departure date (ISO)' })
  @ApiQuery({ name: 'stayDate', required: false, description: 'Stay night for occupancy lookup' })
  @ApiResponse({ status: 200, description: 'Effective rate calculated' })
  getEffectiveRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() context: EffectiveRateQueryDto,
  ) {
    return this.ratePlanService.calculateDerivedRate(id, propertyId, context);
  }

  @Patch(':id')
  @RequirePermissions('rateplans.manage')
  @ApiOperation({ summary: 'Update rate plan' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Rate plan updated' })
  @ApiResponse({ status: 404, description: 'Rate plan not found' })
  updateRatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateRatePlanDto,
  ) {
    return this.ratePlanService.update(id, propertyId, dto);
  }

  // --- Restrictions sub-resource ---

  @Get(':id/restrictions')
  @RequirePermissions('rateplans.read')
  @ApiOperation({ summary: 'Get restrictions for a rate plan' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'List of restrictions' })
  getRestrictions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ratePlanService.findRestrictions(id, propertyId);
  }

  @Post(':id/restrictions')
  @RequirePermissions('rateplans.manage')
  @ApiOperation({ summary: 'Create restriction for a rate plan' })
  @ApiResponse({ status: 201, description: 'Restriction created' })
  createRestriction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRateRestrictionDto,
  ) {
    return this.ratePlanService.createRestriction(id, dto.propertyId, dto);
  }

  @Patch(':id/restrictions/:restrictionId')
  @RequirePermissions('rateplans.manage')
  @ApiOperation({ summary: 'Update a rate restriction' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Restriction updated' })
  @ApiResponse({ status: 404, description: 'Restriction not found' })
  updateRestriction(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('restrictionId', ParseUUIDPipe) restrictionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateRateRestrictionDto,
  ) {
    return this.ratePlanService.updateRestriction(restrictionId, propertyId, dto);
  }

  @Delete(':id/restrictions/:restrictionId')
  @RequirePermissions('rateplans.manage')
  @ApiOperation({ summary: 'Delete a rate restriction' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Restriction deleted' })
  @ApiResponse({ status: 404, description: 'Restriction not found' })
  deleteRestriction(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('restrictionId', ParseUUIDPipe) restrictionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.ratePlanService.deleteRestriction(restrictionId, propertyId);
  }
}
