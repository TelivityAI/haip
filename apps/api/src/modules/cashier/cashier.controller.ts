import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { CashierService } from './cashier.service';
import { CreateDrawerDto } from './dto/create-drawer.dto';
import { OpenSessionDto } from './dto/open-session.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { CloseSessionDto } from './dto/close-session.dto';

@ApiTags('cashier')
@Controller(['cash', 'cashier'])
export class CashierController {
  constructor(private readonly cashierService: CashierService) {}

  @Get()
  @ApiOperation({ summary: 'Cashier API namespace' })
  @ApiResponse({ status: 200, description: 'Available cashier endpoints' })
  cashierIndex() {
    return { endpoints: ['drawers', 'sessions'] };
  }

  @Post('drawers')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Create a cash drawer (KB 12.1)' })
  @ApiResponse({ status: 201, description: 'Cash drawer created' })
  createDrawer(@Body() dto: CreateDrawerDto) {
    return this.cashierService.createDrawer(dto);
  }

  @Get('drawers')
  @ApiOperation({ summary: 'List cash drawers for a property (KB 12.1)' })
  @ApiResponse({ status: 200, description: 'Cash drawers' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiQuery({ name: 'activeOnly', type: Boolean, required: false })
  listDrawers(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const onlyActive = activeOnly === undefined ? true : activeOnly !== 'false';
    return this.cashierService.listDrawers(propertyId, onlyActive);
  }

  @Get('drawers/:id')
  @ApiOperation({ summary: 'Get cash drawer by ID' })
  @ApiResponse({ status: 200, description: 'Cash drawer found' })
  @ApiResponse({ status: 404, description: 'Cash drawer not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getDrawer(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.cashierService.findDrawerById(id, propertyId);
  }

  @Post('sessions')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Open a cash drawer session/shift (KB 12.2)' })
  @ApiResponse({ status: 201, description: 'Session opened' })
  openSession(@Body() dto: OpenSessionDto) {
    return this.cashierService.openSession(dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List cash drawer sessions (resume open shifts)' })
  @ApiResponse({ status: 200, description: 'Sessions' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @ApiQuery({ name: 'cashDrawerId', type: String, required: false })
  @ApiQuery({ name: 'status', enum: ['open', 'closed'], required: false })
  listSessions(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('cashDrawerId') cashDrawerId?: string,
    @Query('status') status?: 'open' | 'closed',
  ) {
    return this.cashierService.listSessions(propertyId, {
      cashDrawerId,
      status,
    });
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get cash session by ID' })
  @ApiResponse({ status: 200, description: 'Session found' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.cashierService.findSessionById(id, propertyId);
  }

  @Post('sessions/:id/movements')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Record a cash movement (KB 12.3)' })
  @ApiResponse({ status: 201, description: 'Movement recorded' })
  recordMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordMovementDto,
  ) {
    return this.cashierService.recordMovement(id, dto);
  }

  @Post('sessions/:id/close')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Close a session and compute variance (KB 12.4)' })
  @ApiResponse({ status: 200, description: 'Session closed' })
  closeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.cashierService.closeSession(id, dto);
  }

  @Get('sessions/:id/report')
  @ApiOperation({ summary: "Cashier's report for a session (KB 12.4)" })
  @ApiResponse({ status: 200, description: 'Cashier report' })
  @ApiQuery({ name: 'propertyId', type: String })
  cashierReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.cashierService.cashierReport(id, propertyId);
  }
}
