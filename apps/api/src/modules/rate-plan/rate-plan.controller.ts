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
import { RatePlanService } from './rate-plan.service';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { CreateRateRestrictionDto } from './dto/create-rate-restriction.dto';
import { UpdateRateRestrictionDto } from './dto/update-rate-restriction.dto';
import { EffectiveRateQueryDto } from './dto/effective-rate-query.dto';

@ApiTags('rate-plans')
@Controller('rate-plans')
export class RatePlanController {
  constructor(private readonly ratePlanService: RatePlanService) {}

  @Get()
  @ApiOperation({ summary: 'Get all rate plans for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'List of rate plans' })
  getAllRatePlans(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.ratePlanService.findAll(propertyId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new rate plan' })
  @ApiResponse({ status: 201, description: 'Rate plan created' })
  createRatePlan(@Body() dto: CreateRatePlanDto) {
    return this.ratePlanService.create(dto);
  }

  @Get(':id')
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
  @Roles('admin')
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
  @Roles('admin')
  @ApiOperation({ summary: 'Create restriction for a rate plan' })
  @ApiResponse({ status: 201, description: 'Restriction created' })
  createRestriction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRateRestrictionDto,
  ) {
    return this.ratePlanService.createRestriction(id, dto.propertyId, dto);
  }

  @Patch(':id/restrictions/:restrictionId')
  @Roles('admin')
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
  @Roles('admin')
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
