import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { ApiKeyGuard, type ConnectPrincipal } from '../auth/api-key.guard';
import { ConnectScopeGuard } from '../auth/connect-scope.guard';
import { ConnectSearchService } from './connect-search.service';
import { ConnectContentService } from './connect-content.service';
import { ConnectBookingService } from './connect-booking.service';
import { ConnectEventsService } from './connect-events.service';
import { ConnectInsightsService } from './connect-insights.service';
import { AgentSearchDto } from './dto/agent-search.dto';
import { AgentBookDto } from './dto/agent-book.dto';
import { AgentModifyDto, AgentCancelDto } from './dto/agent-modify.dto';
import { CreateSubscriptionDto } from './dto/agent-event-subscription.dto';
import { ListPropertiesDto } from './dto/list-properties.dto';

@ApiTags('Connect — OTAIP Agent API')
@ApiSecurity('api-key')
// 'connect' + the global 'api/v1' prefix = /api/v1/connect/* (the documented
// path). Hardcoding 'api/v1/connect' here doubled the prefix to
// /api/v1/api/v1/connect/* because main.ts sets a global prefix.
@Controller('connect')
// @Public() skips the global JWT guard — the Connect API uses an API key
// (x-api-key header) validated by ApiKeyGuard instead. ConnectScopeGuard then
// enforces tenant isolation for property-scoped credentials (the platform
// CONNECT_API_KEY env value is cross-tenant by design — used by the demo
// gateway and other trusted server-side callers).
@Public()
@UseGuards(ApiKeyGuard, ConnectScopeGuard)
export class ConnectController {
  constructor(
    private readonly searchService: ConnectSearchService,
    private readonly contentService: ConnectContentService,
    private readonly bookingService: ConnectBookingService,
    private readonly eventsService: ConnectEventsService,
    private readonly insightsService: ConnectInsightsService,
  ) {}

  // --- Search & Content (Agent 4.1, 4.2, 4.3) ---

  @Post('search')
  @ApiOperation({ summary: 'Search properties with availability and rates (Agent 4.1)' })
  @ApiResponse({ status: 200, description: 'Search results with room types, rates, and nightly breakdown' })
  async search(@Body() dto: AgentSearchDto) {
    return this.searchService.search(dto);
  }

  @Get('properties')
  @ApiOperation({ summary: 'List all properties (Agent 4.2 background sync)' })
  async listProperties(@Query() dto: ListPropertiesDto, @Req() req: any) {
    const principal = req.connect as ConnectPrincipal | undefined;
    if (principal?.scope === 'property' && principal.propertyId) {
      // Property-scoped credentials only ever see their one tenant.
      const detail = await this.contentService.getPropertyDetail(principal.propertyId);
      return detail ? [detail] : [];
    }
    return this.contentService.listProperties(dto.limit, dto.offset);
  }

  @Get('properties/:id')
  @ApiOperation({ summary: 'Get detailed property content (Agent 4.2, 4.3)' })
  async getProperty(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    // `:id` IS the tenant on this route — ConnectScopeGuard intentionally does
    // NOT enforce `params.id` (it would over-deny on /subscriptions/:id where
    // `:id` is a subscription UUID). Enforce membership here where the route
    // semantics are explicit.
    const principal = req.connect as ConnectPrincipal | undefined;
    if (principal?.scope === 'property' && principal.propertyId !== id) {
      throw new ForbiddenException('Credential is not scoped to this property');
    }
    return this.contentService.getPropertyDetail(id);
  }

  // --- Booking Lifecycle (Agent 4.5, 4.6, 4.7) ---

  @Post('book')
  @ApiOperation({ summary: 'Book a room — auto-confirms for agent bookings (Agent 4.5)' })
  @ApiResponse({ status: 201, description: 'Booking confirmed with confirmation codes and nightly breakdown' })
  async book(@Body() dto: AgentBookDto) {
    return this.bookingService.book(dto);
  }

  @Get('bookings/:confirmationNumber/verify')
  @ApiOperation({ summary: 'Verify booking status and details (Agent 4.7)' })
  async verify(@Param('confirmationNumber') confirmationNumber: string) {
    return this.bookingService.verify(confirmationNumber);
  }

  @Patch('bookings/:confirmationNumber')
  @ApiOperation({ summary: 'Modify a booking — free or rate-affecting changes (Agent 4.6)' })
  async modify(
    @Param('confirmationNumber') confirmationNumber: string,
    @Body() dto: AgentModifyDto,
  ) {
    return this.bookingService.modify(confirmationNumber, dto);
  }

  @Delete('bookings/:confirmationNumber')
  @ApiOperation({ summary: 'Cancel a booking with penalty calculation (Agent 4.6)' })
  async cancel(
    @Param('confirmationNumber') confirmationNumber: string,
    @Body() dto: AgentCancelDto,
  ) {
    return this.bookingService.cancel(confirmationNumber, dto.reason);
  }

  // --- Event Subscriptions ---

  @Post('subscriptions')
  @ApiOperation({ summary: 'Subscribe to PMS events' })
  async createSubscription(@Body() dto: CreateSubscriptionDto) {
    return this.eventsService.createSubscription(dto);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List event subscriptions for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  async listSubscriptions(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.eventsService.listSubscriptions(propertyId);
  }

  @Delete('subscriptions/:id')
  @ApiOperation({ summary: 'Unsubscribe from events' })
  @ApiQuery({ name: 'propertyId', required: true })
  async deleteSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.eventsService.deleteSubscription(id, propertyId);
  }

  @Post('subscriptions/:id/test')
  @ApiOperation({ summary: 'Send a test event to verify callback URL' })
  @ApiQuery({ name: 'propertyId', required: true })
  async testSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.eventsService.testSubscription(id, propertyId);
  }

  @Get('subscriptions/:id/deliveries')
  @ApiOperation({ summary: 'List webhook delivery attempts for a subscription' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  async listDeliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('limit') limit?: string,
  ) {
    return this.eventsService.listDeliveries(
      id,
      propertyId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  // --- Event Polling ---

  @Get('events')
  @ApiOperation({ summary: 'Poll for events (fallback for agents without webhook support)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'since', required: false, description: 'ISO datetime' })
  @ApiQuery({ name: 'types', required: false, description: 'Comma-separated event types' })
  @ApiQuery({ name: 'limit', required: false })
  async pollEvents(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('since') since?: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
  ) {
    const typeList = types ? types.split(',').map((t) => t.trim()) : undefined;
    return this.eventsService.pollEvents(
      propertyId,
      since,
      typeList,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  // --- Insights (PMS-Native Intelligence) ---

  @Get('insights/revenue')
  @ApiOperation({ summary: 'Revenue optimization hints with demand-based suggestions' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true, description: 'Business date (YYYY-MM-DD)' })
  async getRevenueInsights(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.insightsService.getRevenueInsights(propertyId, date);
  }

  @Get('insights/guest-triggers')
  @ApiOperation({ summary: 'Guest communication triggers across stay lifecycle' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  async getGuestTriggers(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.insightsService.getGuestTriggers(propertyId, date);
  }

  @Get('insights/housekeeping')
  @ApiOperation({ summary: 'Housekeeping optimization with priority ordering and staffing hints' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  async getHousekeepingInsights(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.insightsService.getHousekeepingInsights(propertyId, date);
  }
}
