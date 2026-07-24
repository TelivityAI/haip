import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  CreateIcalFeedDto,
  ListIcalBlocksDto,
  ListIcalFeedsDto,
  UpdateIcalFeedDto,
} from './dto/ical.dto';
import { IcalService } from './ical.service';

@ApiTags('iCal')
@Controller('ical')
export class IcalController {
  constructor(private readonly icalService: IcalService) {}

  @Public()
  @Get('export.ics')
  @ApiOperation({ summary: 'Token-authenticated iCal export feed' })
  @ApiQuery({ name: 'token', required: true })
  @ApiResponse({ status: 200, description: 'text/calendar feed' })
  async exportCalendar(
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token) throw new BadRequestException('token is required');
    const ics = await this.icalService.exportCalendar(token);
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return ics;
  }

  @Post('feeds')
  @Roles('admin')
  @ApiOperation({ summary: 'Create an iCal import or export feed' })
  @ApiResponse({ status: 201, description: 'iCal feed created' })
  createFeed(@Body() dto: CreateIcalFeedDto) {
    return this.icalService.create(dto);
  }

  @Get('feeds')
  @Roles('admin')
  @ApiOperation({ summary: 'List iCal feeds for a property' })
  listFeeds(@Query() dto: ListIcalFeedsDto) {
    return this.icalService.list(dto);
  }

  @Get('feeds/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get an iCal feed' })
  @ApiQuery({ name: 'propertyId', required: true })
  getFeed(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.icalService.findById(id, propertyId);
  }

  @Patch('feeds/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update an iCal feed' })
  @ApiQuery({ name: 'propertyId', required: true })
  updateFeed(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateIcalFeedDto,
  ) {
    return this.icalService.update(id, propertyId, dto);
  }

  @Delete('feeds/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete an iCal feed and its imported blocks' })
  @ApiQuery({ name: 'propertyId', required: true })
  deleteFeed(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.icalService.delete(id, propertyId);
  }

  @Post('feeds/:id/sync')
  @Roles('admin')
  @ApiOperation({ summary: 'Fetch an import feed and replace its busy blocks' })
  @ApiQuery({ name: 'propertyId', required: true })
  syncFeed(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.icalService.syncImportFeed(id, propertyId);
  }

  @Post('feeds/:id/rotate-token')
  @Roles('admin')
  @ApiOperation({ summary: 'Rotate the signed token for an export feed' })
  @ApiQuery({ name: 'propertyId', required: true })
  rotateToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.icalService.rotateExportToken(id, propertyId);
  }

  @Get('feeds/:id/blocks')
  @Roles('admin')
  @ApiOperation({ summary: 'List imported busy blocks for a feed' })
  @ApiQuery({ name: 'propertyId', required: true })
  listBlocks(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: ListIcalBlocksDto,
  ) {
    return this.icalService.listBlocks(id, dto);
  }
}
