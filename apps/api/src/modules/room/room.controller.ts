import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { RoomService } from './room.service';
import { RoomStatusService } from './room-status.service';
import { RoomDiscrepancyService } from './room-discrepancy.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import { HkObservationDto } from './dto/hk-observation.dto';
import {
  ResolveDiscrepancyDto,
  DismissDiscrepancyDto,
  EnsureDiscrepancyCaseDto,
} from './dto/resolve-discrepancy.dto';

@ApiTags('rooms', 'room-types')
@Controller('rooms')
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomStatusService: RoomStatusService,
    private readonly roomDiscrepancyService: RoomDiscrepancyService,
  ) {}

  // --- Room Type routes (before :id to avoid conflicts) ---

  @Get('types')
  @ApiOperation({ summary: 'Get all room types for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'List of room types' })
  getRoomTypes(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.roomService.findAllRoomTypes(propertyId);
  }

  @Post('types')
  @Roles('admin', 'front_desk', 'housekeeping_manager')
  @ApiOperation({ summary: 'Create new room type' })
  @ApiResponse({ status: 201, description: 'Room type created' })
  createRoomType(@Body() dto: CreateRoomTypeDto) {
    return this.roomService.createRoomType(dto);
  }

  @Get('types/:id')
  @ApiOperation({ summary: 'Get room type by ID' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room type found' })
  @ApiResponse({ status: 404, description: 'Room type not found' })
  getRoomTypeById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.roomService.findRoomTypeById(id, propertyId);
  }

  // --- Room status routes (before :id to avoid conflicts) ---

  @Get('status-summary')
  @ApiOperation({ summary: 'Get room count by status for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room counts by status' })
  getStatusSummary(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.roomStatusService.getPropertyRoomSummary(propertyId);
  }

  @Get('by-status')
  @ApiOperation({ summary: 'Get rooms filtered by status' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'status', required: true })
  @ApiResponse({ status: 200, description: 'Rooms with specified status' })
  getRoomsByStatus(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('status') status: string,
  ) {
    return this.roomStatusService.getRoomsByStatus(propertyId, status);
  }

  @Get('discrepancies')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'List room status discrepancies for a business date' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true, description: 'Business date (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Computed room status discrepancies' })
  getDiscrepancies(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.roomDiscrepancyService.getDiscrepancies(propertyId, date);
  }

  @Get('discrepancies/open-count')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'Open discrepancy case count (night-audit acknowledge hint)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  openDiscrepancyCount(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.roomDiscrepancyService.openCaseCount(propertyId, date);
  }

  @Post('discrepancies/cases')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Ensure an open discrepancy case exists for a computed mismatch' })
  @ApiQuery({ name: 'propertyId', required: true })
  ensureDiscrepancyCase(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: EnsureDiscrepancyCaseDto,
  ) {
    return this.roomDiscrepancyService.ensureCase(propertyId, dto as any);
  }

  @Post('discrepancies/cases/:caseId/resolve')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Resolve a discrepancy case with an action + note' })
  @ApiQuery({ name: 'propertyId', required: true })
  resolveDiscrepancyCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ResolveDiscrepancyDto,
  ) {
    return this.roomDiscrepancyService.resolveCase(caseId, propertyId, dto);
  }

  @Post('discrepancies/cases/:caseId/dismiss')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Dismiss a discrepancy case (note required)' })
  @ApiQuery({ name: 'propertyId', required: true })
  dismissDiscrepancyCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: DismissDiscrepancyDto,
  ) {
    return this.roomDiscrepancyService.dismissCase(caseId, propertyId, dto);
  }

  // --- Room routes ---

  @Get()
  @ApiOperation({ summary: 'Get all rooms for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'roomTypeId', required: false })
  @ApiResponse({ status: 200, description: 'List of rooms' })
  getAllRooms(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('roomTypeId') roomTypeId?: string,
  ) {
    return this.roomService.findAllRooms(propertyId, roomTypeId);
  }

  @Post()
  @Roles('admin', 'front_desk', 'housekeeping_manager')
  @ApiOperation({ summary: 'Create new room' })
  @ApiResponse({ status: 201, description: 'Room created' })
  createRoom(@Body() dto: CreateRoomDto) {
    return this.roomService.createRoom(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get room by ID' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room found' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  getRoomById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.roomService.findRoomById(id, propertyId);
  }

  @Patch(':id/status')
  @Roles('admin', 'front_desk', 'housekeeping_manager')
  @ApiOperation({ summary: 'Update room status with transition validation' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room status updated' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  updateRoomStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateRoomStatusDto,
  ) {
    return this.roomStatusService.transitionStatus(id, propertyId, dto.status as any, dto.maintenanceNotes);
  }

  @Put(':id/hk-observation')
  @Roles('admin', 'front_desk', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Set housekeeping observed occupancy for discrepancy detection' })
  @ApiQuery({ name: 'propertyId', required: true })
  setHkObservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: HkObservationDto,
  ) {
    return this.roomDiscrepancyService.setHkObservation(id, propertyId, dto);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk', 'housekeeping_manager')
  @ApiOperation({ summary: 'Update room' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room updated' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  updateRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomService.updateRoom(id, propertyId, dto);
  }
}
