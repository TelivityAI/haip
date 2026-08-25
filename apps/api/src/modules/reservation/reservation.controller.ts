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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
  @ApiOperation({ summary: 'Batch import reservations from pre-parsed JSON rows (per-row status)' })
  @ApiResponse({ status: 200, description: 'Per-row import results with created/failed counts' })
  importReservations(@Body() dto: ImportReservationsDto) {
    return this.importService.importReservations(dto.propertyId, dto);
  }

  // --- Note mutation routes (STATIC paths — MUST precede ':id' routes) ---

  @Patch('notes/:noteId')
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
  @ApiOperation({
    summary: 'Modify reservation (dates, room type, rate, occupancy)',
    description:
      'Allowed: arrivalDate, departureDate, roomTypeId, ratePlanId, totalAmount, adults, children, specialRequests, doNotMove. Not patchable: source, channelCode, status, guestId (use dedicated lifecycle routes for status).',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiResponse({ status: 200, description: 'Reservation modified' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  async modifyReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ModifyReservationDto,
  ) {
    const result = await this.reservationService.modify(id, propertyId, dto);
    return result.reservation;
  }

  // --- Lifecycle transition routes ---

  @Patch(':id/confirm')
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
  @ApiOperation({
    summary: 'Cancel reservation with optional reason',
    description:
      'Optional body field: `cancellationReason` (preferred) or `reason` (alias matching Connect/bulk). Empty body is allowed.',
  })
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
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
  @RequirePermissions('reservations.write')
  @ApiOperation({ summary: 'Compose and send an email or SMS to the reservation guest (GDPR-aware)' })
  @ApiResponse({ status: 201, description: 'Email send/draft result' })
  composeMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ComposeMessageDto,
  ) {
    return this.messagingService.composeMessage(dto.propertyId, id, dto);
  }
}
