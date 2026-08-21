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
import { ReservationPartyService } from './reservation-party.service';
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
import { PreRegisterDto } from './dto/pre-register.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { GroupCheckInDto } from './dto/group-check-in.dto';
import { BulkActionDto } from './dto/bulk-action.dto';
import { ListUnassignedDto } from './dto/list-unassigned.dto';
import { ImportReservationsDto } from './dto/import-reservations.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ComposeMessageDto } from './dto/compose-message.dto';
import { AddReservationGuestDto } from './dto/add-reservation-guest.dto';
import { SplitReservationDto } from './dto/split-reservation.dto';
import { MoveReservationGuestDto } from './dto/move-reservation-guest.dto';
import { resolvePropertyId } from '../../common/property-id';

@ApiTags('reservations')
@Controller('reservations')
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly partyService: ReservationPartyService,
    private readonly availabilityService: AvailabilityService,
    private readonly notesService: ReservationNotesService,
    private readonly messagingService: ReservationMessagingService,
    private readonly importService: ReservationImportService,
  ) {}

  // --- Action routes BEFORE :id to avoid conflicts ---

  @Post('search-availability')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({ summary: 'Batch import reservations from pre-parsed JSON rows (per-row status)' })
  @ApiResponse({ status: 200, description: 'Per-row import results with created/failed counts' })
  importReservations(@Body() dto: ImportReservationsDto) {
    return this.importService.importReservations(dto.propertyId, dto);
  }

  // --- Note mutation routes (STATIC paths — MUST precede ':id' routes) ---

  @Patch('notes/:noteId')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @ApiOperation({
    summary: 'List reservations with filters (propertyId required)',
    description:
      'Paginated. Default limit=20. Response: { data, total, page, limit, hasMore }. Always read total/hasMore — a naive client that only looks at data silently gets page 1.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of reservations',
    schema: {
      example: {
        data: [{ id: '…', status: 'confirmed', arrivalDate: '2026-08-01' }],
        total: 47,
        page: 1,
        limit: 20,
        hasMore: true,
      },
    },
  })
  listReservations(@Query() dto: ListReservationsDto) {
    return this.reservationService.list(dto);
  }

  @Post()
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({
    summary: 'Create new reservation (status: pending)',
    description:
      'Optional externalConfirmation stores the source-system reference on the booking (same field channel inbound uses).',
  })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  createReservation(@Body() dto: CreateReservationDto) {
    return this.reservationService.create(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get reservation with guest, room, and rate details',
    description:
      'Envelope is NOT { data }. Returns { reservation, guest, roomType, ratePlan, room, confirmationNumber }.',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({
    status: 200,
    description: 'Reservation found',
    schema: {
      example: {
        reservation: { id: '…', status: 'confirmed' },
        guest: { id: '…', firstName: 'Ada' },
        roomType: { id: '…', name: 'King' },
        ratePlan: { id: '…', name: 'BAR' },
        room: null,
        confirmationNumber: 'HAIP-…',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  getReservationById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.reservationService.findById(id, propertyId);
  }

  @Patch(':id')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({
    summary: 'Modify reservation (dates, room type, rate, occupancy)',
    description:
      'Allowed: arrivalDate, departureDate, roomTypeId, ratePlanId, totalAmount, adults, children, specialRequests, doNotMove. Not patchable: source, channelCode, status, guestId (use dedicated lifecycle routes for status).',
  })
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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

  // --- Multi-guest / multi-room party ops (booking wrapper pattern) ---

  @Get(':id/guests')
  @ApiOperation({ summary: 'List named guests (primary + accompanying) on a reservation' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Named occupants' })
  listReservationGuests(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.partyService.listGuests(id, propertyId);
  }

  @Post(':id/guests')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({ summary: 'Add an accompanying guest to this room reservation' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 201, description: 'Guest added' })
  addReservationGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AddReservationGuestDto,
  ) {
    return this.partyService.addGuest(id, propertyId, dto);
  }

  @Delete(':id/guests/:guestId')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({ summary: 'Remove an accompanying guest from this reservation' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Guest removed' })
  removeReservationGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.partyService.removeGuest(id, propertyId, guestId);
  }

  @Post(':id/guests/:guestId/move')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({
    summary: 'Move a named guest to another reservation on the same booking',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Guest moved' })
  moveReservationGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: MoveReservationGuestDto,
  ) {
    return this.partyService.moveGuest(id, propertyId, guestId, dto);
  }

  @Post(':id/split')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({
    summary:
      'Split guests onto a new sibling reservation under the same booking (new room)',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 201, description: 'Split completed' })
  splitReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: SplitReservationDto,
  ) {
    return this.partyService.split(id, propertyId, dto);
  }

  @Get(':id/booking-siblings')
  @ApiOperation({
    summary: 'List other active reservations on the same booking (sibling rooms)',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Sibling reservations' })
  listBookingSiblings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.partyService.listBookingSiblings(id, propertyId);
  }

  @Patch(':id/cancel')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({ summary: 'Mark reservation as no-show' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation marked as no-show' })
  markNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.reservationService.markNoShow(id, propertyId);
  }

  @Post(':id/pre-register')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({
    summary:
      'Advance check-in / pre-register — capture registration card and ID without checking in',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Registration fields saved; status unchanged' })
  preRegister(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: PreRegisterDto,
  ) {
    return this.reservationService.preRegister(id, propertyId, dto);
  }

  @Patch(':id/check-in')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
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
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({
    summary: 'Add a note to a reservation',
    description:
      'propertyId may be sent in the JSON body (preferred) or as ?propertyId= when omitted from the body. If both are sent they must match.',
  })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Alias when body omits propertyId',
  })
  @ApiResponse({ status: 201, description: 'Note created' })
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
    @Query('propertyId', new ParseUUIDPipe({ optional: true })) queryPropertyId?: string,
  ) {
    const propertyId = resolvePropertyId({ body: dto.propertyId, query: queryPropertyId });
    return this.notesService.createNote(propertyId, id, dto);
  }

  @Get(':id/notes')
  @ApiOperation({
    summary: 'List notes for a reservation (with active count)',
    description: 'Envelope is { notes, activeCount } — not { data }.',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({
    status: 200,
    description: 'Notes and active count',
    schema: {
      example: {
        notes: [{ id: '…', body: 'VIP', isActive: true }],
        activeCount: 1,
      },
    },
  })
  listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.notesService.listNotes(propertyId, id);
  }

  // --- Guest messaging ---

  @Post(':id/messages')
  @Roles('admin', 'general_manager', 'front_desk', 'reservations')
  @ApiOperation({ summary: 'Compose and send an email or SMS to the reservation guest (GDPR-aware)' })
  @ApiResponse({ status: 201, description: 'Email send/draft result' })
  composeMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ComposeMessageDto,
  ) {
    return this.messagingService.composeMessage(dto.propertyId, id, dto);
  }
}
