import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { ChannelService } from './channel.service';
import { AriService } from './ari.service';
import { ContentSyncService } from './content-sync.service';
import { InboundReservationService } from './inbound-reservation.service';
import { RateParityService } from './rate-parity.service';
import { CreateChannelConnectionDto } from './dto/create-channel-connection.dto';
import { UpdateChannelConnectionDto } from './dto/update-channel-connection.dto';
import { PushAriDto } from './dto/push-ari.dto';
import { PushContentDto } from './dto/push-content.dto';
import { InboundReservationDto } from './dto/inbound-reservation.dto';
import { StopSellDto } from './dto/stop-sell.dto';

@ApiTags('Channel Manager')
@Controller('channels')
@Roles('admin')
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly ariService: AriService,
    private readonly contentSyncService: ContentSyncService,
    private readonly inboundReservationService: InboundReservationService,
    private readonly rateParityService: RateParityService,
  ) {}

  // --- Channel Connection CRUD ---

  @Post('connections')
  @ApiOperation({ summary: 'Create a new channel connection' })
  async createConnection(@Body() dto: CreateChannelConnectionDto) {
    return this.channelService.create(dto);
  }

  @Get('connections')
  @ApiOperation({ summary: 'List active channel connections for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  async listConnections(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.channelService.list(propertyId);
  }

  @Get('connections/:id')
  @ApiOperation({ summary: 'Get a channel connection by ID' })
  @ApiQuery({ name: 'propertyId', required: true })
  async getConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.channelService.findById(id, propertyId);
  }

  @Patch('connections/:id')
  @ApiOperation({ summary: 'Update a channel connection' })
  @ApiQuery({ name: 'propertyId', required: true })
  async updateConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateChannelConnectionDto,
  ) {
    return this.channelService.update(id, propertyId, dto);
  }

  @Delete('connections/:id')
  @ApiOperation({ summary: 'Deactivate a channel connection' })
  @ApiQuery({ name: 'propertyId', required: true })
  async deactivateConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.channelService.deactivate(id, propertyId);
  }

  @Post('connections/:id/test')
  @ApiOperation({ summary: 'Test a channel connection' })
  @ApiQuery({ name: 'propertyId', required: true })
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.channelService.testConnection(id, propertyId);
  }

  // --- ARI Push ---

  @Post('push/availability')
  @ApiOperation({ summary: 'Push availability to channels' })
  async pushAvailability(@Body() dto: PushAriDto) {
    return this.ariService.pushAvailability(
      dto.propertyId,
      dto.startDate,
      dto.endDate,
      dto.channelConnectionId,
    );
  }

  @Post('push/rates')
  @ApiOperation({ summary: 'Push rates and restrictions to channels' })
  async pushRates(@Body() dto: PushAriDto) {
    return this.ariService.pushRates(
      dto.propertyId,
      dto.startDate,
      dto.endDate,
      dto.channelConnectionId,
    );
  }

  @Post('push/full')
  @ApiOperation({ summary: 'Push full ARI (availability + rates + restrictions) to channels' })
  async pushFullARI(@Body() dto: PushAriDto) {
    return this.ariService.pushFullARI(
      dto.propertyId,
      dto.startDate,
      dto.endDate,
      dto.channelConnectionId,
    );
  }

  @Post('push/stop-sell')
  @ApiOperation({ summary: 'Push stop-sell (zero availability) to a channel' })
  @ApiQuery({ name: 'channelConnectionId', required: true })
  async pushStopSell(
    @Query('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Body() dto: StopSellDto,
  ) {
    return this.ariService.pushStopSell(
      channelConnectionId,
      dto.propertyId,
      dto.startDate,
      dto.endDate,
      dto.roomTypeId,
    );
  }

  // --- Content Push ---

  @Post('push/content')
  @ApiOperation({ summary: 'Push descriptive content (photos, descriptions, amenities) to channels' })
  async pushContent(@Body() dto: PushContentDto) {
    return this.contentSyncService.pushContent(dto.propertyId, dto.channelConnectionId);
  }

  @Get('content-sync-logs/:channelConnectionId')
  @ApiOperation({ summary: 'Get content-push logs for a channel connection' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  async getContentSyncLogs(
    @Param('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentSyncService.getContentSyncLogs(
      channelConnectionId,
      propertyId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  // --- Sync Logs ---

  @Get('sync-logs/:channelConnectionId')
  @ApiOperation({ summary: 'Get sync logs for a channel connection' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  async getSyncLogs(
    @Param('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('limit') limit?: string,
  ) {
    return this.ariService.getSyncLogs(
      channelConnectionId,
      propertyId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  // --- Inbound Reservations ---

  @Post('inbound/reservation')
  @ApiOperation({ summary: 'Process an inbound reservation from a channel' })
  async processInboundReservation(@Body() dto: InboundReservationDto) {
    return this.inboundReservationService.processInboundReservation(
      dto.channelConnectionId,
      dto.reservation as any,
    );
  }

  @Post('inbound/pull')
  @ApiOperation({ summary: 'Pull and process reservations from a channel' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'channelConnectionId', required: true })
  @ApiQuery({ name: 'since', required: false })
  async pullReservations(
    @Query('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('since') since?: string,
  ) {
    return this.inboundReservationService.pullAndProcessReservations(
      channelConnectionId,
      propertyId,
      since ? new Date(since) : undefined,
    );
  }

  // --- Rate Parity ---

  @Get('rate-parity')
  @ApiOperation({ summary: 'Check rate parity across channels' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'ratePlanId', required: false })
  async checkRateParity(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('ratePlanId') ratePlanId?: string,
  ) {
    return this.rateParityService.checkParity(propertyId, ratePlanId);
  }

  @Get('rate-parity/effective-rate')
  @ApiOperation({ summary: 'Get effective rate for a rate plan on a channel' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'ratePlanId', required: true })
  @ApiQuery({ name: 'channelConnectionId', required: true })
  @ApiQuery({ name: 'date', required: false })
  async getEffectiveRate(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('ratePlanId', ParseUUIDPipe) ratePlanId: string,
    @Query('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Query('date') date?: string,
  ) {
    return this.rateParityService.getEffectiveRate(
      propertyId,
      ratePlanId,
      channelConnectionId,
      date,
    );
  }

  @Post('rate-parity/override')
  @ApiOperation({ summary: 'Set a rate override for a channel' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'channelConnectionId', required: true })
  async setRateOverride(
    @Query('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() override: any,
  ) {
    return this.rateParityService.setRateOverride(channelConnectionId, propertyId, {
      channelConnectionId,
      ...override,
    });
  }

  @Delete('rate-parity/override')
  @ApiOperation({ summary: 'Remove a rate override' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'channelConnectionId', required: true })
  @ApiQuery({ name: 'ratePlanId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async removeRateOverride(
    @Query('channelConnectionId', ParseUUIDPipe) channelConnectionId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('ratePlanId', ParseUUIDPipe) ratePlanId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.rateParityService.removeRateOverride(
      channelConnectionId,
      propertyId,
      ratePlanId,
      startDate,
      endDate,
    );
  }
}
