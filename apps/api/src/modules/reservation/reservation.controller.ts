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
import { ReservationService } from './reservation.service';
import { AvailabilityService } from './availability.service';
import { ReservationNotesService } from './reservation-notes.service';
import { ReservationMessagingService } from './reservation-messaging.service';
import { ReservationImportService } from './reservation-import.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ModifyReservationDto } from './dto/modify-reservation.dto';
import { AssignRoomDto } from './dto/assign-room.dto';
import { MoveRoomDto } from './dto/move-room.dto';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { SearchAvailabilityDto } from './dto/search-availability.dto';
import { ListReservationsDto } from './dto/list-reservations.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { GroupCheckInDto } from './dto/group-check-in.dto';
import { BulkActionDto } from './dto/bulk-action.dto';
import { ListUnassignedDto } from './dto/list-unassigned.dto';
import { ImportReservationsDto } from './dto/import-reservations.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ComposeMessageDto } from './dto/compose-message.dto';

@ApiTags('reservations')
@Controller('reservations')
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly availabilityService: AvailabilityService,
    private readonly notesService: ReservationNotesService,
    private readonly messagingService: ReservationMessagingService,
    private readonly importService: ReservationImportService,
  ) {}

  // --- Action routes BEFORE :id to avoid conflicts ---

  @Post('search-availability')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Search room availability for a date range' })
  @ApiResponse({ status: 200, description: 'Availability results' })
  searchAvailability(@Body() dto: SearchAvailabilityDto) {
    return this.availabilityService.searchAvailability(
      dto.propertyId,
      dto.checkIn,
      dto.checkOut,
      dto.roomTypeId,
    );
  }

  @Post('group-check-in')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Batch check-in for group reservations' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Group check-in results (partial success allowed)' })
  groupCheckIn(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: GroupCheckInDto,
  ) {
    return this.reservationService.groupCheckIn(propertyId, dto);
  }

  @Post('bulk-action')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Apply check_in/check_out/cancel to many reservations (partial success allowed)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Per-id results with succeeded/failed counts' })
  bulkAction(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: BulkActionDto,
  ) {
    return this.reservationService.bulkAction(propertyId, dto);
  }

  @Get('unassigned')
  @ApiOperation({ summary: 'Find assignable-but-unassigned reservations (no room) in a date window' })
  @ApiResponse({ status: 200, description: 'Unassigned reservations with reason hints' })
  findUnassigned(@Query() dto: ListUnassignedDto) {
    return this.reservationService.findUnassigned(dto);
  }

  @Post('import')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Batch import reservations from pre-parsed JSON rows (per-row status)' })
  @ApiResponse({ status: 200, description: 'Per-row import results with created/failed counts' })
  importReservations(@Body() dto: ImportReservationsDto) {
    return this.importService.importReservations(dto.propertyId, dto);
  }

  // --- Note mutation routes (STATIC paths — MUST precede ':id' routes) ---

  @Patch('notes/:noteId')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Update a reservation note (body / active flag)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Note updated' })
  updateNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notesService.updateNote(noteId, propertyId, dto);
  }

  @Delete('notes/:noteId')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Delete a reservation note' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Note deleted' })
  deleteNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.notesService.deleteNote(noteId, propertyId);
  }

  // --- CRUD routes ---

  @Get()
  @ApiOperation({ summary: 'List reservations with filters (propertyId required)' })
  @ApiResponse({ status: 200, description: 'Paginated list of reservations' })
  listReservations(@Query() dto: ListReservationsDto) {
    return this.reservationService.list(dto);
  }

  @Post()
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Create new reservation (status: pending)' })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  createReservation(@Body() dto: CreateReservationDto) {
    return this.reservationService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reservation with guest, room, and rate details' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation found' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  getReservationById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.reservationService.findById(id, propertyId);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Modify reservation (dates, room type, rate, occupancy)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation modified' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  modifyReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ModifyReservationDto,
  ) {
    return this.reservationService.modify(id, propertyId, dto);
  }

  // --- Lifecycle transition routes ---

  @Patch(':id/confirm')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Confirm reservation' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation confirmed' })
  confirmReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.reservationService.confirm(id, propertyId);
  }

  @Patch(':id/assign-room')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Assign specific room to reservation' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room assigned' })
  assignRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AssignRoomDto,
  ) {
    return this.reservationService.assignRoom(id, propertyId, dto);
  }

  @Patch(':id/move-room')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Move assigned or in-house reservation to another room' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Room moved' })
  moveRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: MoveRoomDto,
  ) {
    return this.reservationService.moveRoom(id, propertyId, dto);
  }

  @Patch(':id/cancel')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Cancel reservation with optional reason' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation cancelled' })
  cancelReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CancelReservationDto,
  ) {
    return this.reservationService.cancel(id, propertyId, dto);
  }

  @Patch(':id/no-show')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Mark reservation as no-show' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation marked as no-show' })
  markNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.reservationService.markNoShow(id, propertyId);
  }

  @Patch(':id/check-in')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Check in reservation with optional ID capture, deposit auth, room override' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Guest checked in' })
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CheckInDto,
  ) {
    return this.reservationService.checkIn(id, propertyId, dto);
  }

  @Patch(':id/check-out')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Check out reservation with optional express checkout and late fee' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Guest checked out' })
  checkOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CheckOutDto,
  ) {
    return this.reservationService.checkOut(id, propertyId, dto);
  }

  @Post(':id/express-checkout')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Express checkout — auto-capture deposits and settle' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Express checkout completed' })
  expressCheckOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.reservationService.expressCheckOut(id, propertyId);
  }

  // --- Reservation notes ---

  @Post(':id/notes')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Add a note to a reservation' })
  @ApiResponse({ status: 201, description: 'Note created' })
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.notesService.createNote(dto.propertyId, id, dto);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: 'List notes for a reservation (with active count)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Notes and active count' })
  listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.notesService.listNotes(propertyId, id);
  }

  // --- Guest messaging ---

  @Post(':id/messages')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Compose and send an email to the reservation guest (GDPR-aware)' })
  @ApiResponse({ status: 201, description: 'Email send/draft result' })
  composeMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ComposeMessageDto,
  ) {
    return this.messagingService.composeMessage(dto.propertyId, id, dto);
  }
}
