import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AuditActor, RequirePermissions } from '@telivityhaip/shared';
import { AuditActorCtx } from './audit-actor-ctx.decorator.js';
import { BookingRequestPaymentService } from '../domain/booking-request-payment.service.js';
import { BookingRequestMailerService } from '../domain/booking-request-mailer.service.js';
import { BookingRequestService } from '../domain/booking-request.service.js';
// DTOs must remain runtime imports for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AcceptBookingRequestDto } from './dto/accept-booking-request.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  AmendBookingRequestStayDto,
  PreviewBookingRequestStayAmendmentDto,
} from './dto/amend-booking-request-stay.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DenyBookingRequestDto } from './dto/deny-booking-request.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ListBookingRequestsDto } from './dto/list-booking-requests.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ListBookingRequestAuditDto } from './dto/list-booking-request-audit.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  AllocateBookingRequestPaymentDto,
  ChargeBookingRequestCardDto,
  CreateBookingRequestInstallmentDto,
  RecordBookingRequestExternalPaymentDto,
  RecordBookingRequestExternalReturnDto,
  ReorderBookingRequestInstallmentsDto,
  RefundBookingRequestPaymentDto,
  RetainBookingRequestPaymentDto,
  UpdateBookingRequestInstallmentDto,
} from './dto/booking-request-payment.dto.js';

@ApiTags('booking-requests')
@Controller('booking-requests')
export class BookingRequestController {
  constructor(
    @Inject(BookingRequestService) private readonly service: BookingRequestService,
    @Inject(BookingRequestPaymentService)
    private readonly paymentService: BookingRequestPaymentService,
    @Inject(BookingRequestMailerService)
    private readonly mailer: BookingRequestMailerService,
  ) {}

  @Get()
  @RequirePermissions('reservations.read')
  @ApiOperation({ summary: 'List property-scoped booking requests' })
  list(@Query() dto: ListBookingRequestsDto) {
    return this.service.list(dto);
  }

  @Get(':id')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Get a property-scoped booking request' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.service.findById(id, propertyId);
  }

  @Get(':id/audit-history')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'List immutable sanitized Booking Request audit history' })
  auditHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListBookingRequestAuditDto,
  ) {
    return this.service.auditHistory(id, query.propertyId, query);
  }

  @Get(':id/acceptance-preview')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Preview authoritative totals before accepting a request' })
  acceptancePreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.service.acceptancePreview(id, propertyId);
  }

  @Get(':id/stay-amendment-preview')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Preview an accepted Booking Request stay amendment' })
  stayAmendmentPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() dto: PreviewBookingRequestStayAmendmentDto,
  ) {
    return this.service.stayAmendmentPreview(id, propertyId, dto);
  }

  @Post(':id/stay-amendments')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Atomically amend an accepted Booking Request stay' })
  amendStay(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AmendBookingRequestStayDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.service.amendStay(id, propertyId, dto, actor);
  }

  @Get(':id/emails')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'List Booking Request email delivery history' })
  listEmailDeliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.mailer.listForRequest(id, propertyId);
  }

  @Post(':id/emails/:deliveryId/retry')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Retry a Booking Request email delivery' })
  retryEmailDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.mailer.retry(deliveryId, id, propertyId, actor);
  }

  @Post(':id/accept')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Accept a request and create its reservation' })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AcceptBookingRequestDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.service.accept(id, propertyId, dto, actor);
  }

  @Post(':id/deny')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Deny a request after resolving captured money' })
  deny(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: DenyBookingRequestDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.service.deny(id, propertyId, dto, actor);
  }

  @Get(':id/installments')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'List a Booking Request payment plan' })
  listInstallments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.paymentService.listInstallments(id, propertyId);
  }

  @Post(':id/installments')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Add an informational payment-plan installment' })
  createInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateBookingRequestInstallmentDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.createInstallment(id, propertyId, dto, actor);
  }

  @Patch(':id/installments/reorder')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Atomically reorder an entire Booking Request payment plan' })
  reorderInstallments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ReorderBookingRequestInstallmentsDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.reorderInstallments(id, propertyId, dto, actor);
  }

  @Patch(':id/installments/:installmentId')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Edit an installment without reducing it below durable allocations' })
  updateInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateBookingRequestInstallmentDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.updateInstallment(
      id,
      installmentId,
      propertyId,
      dto,
      actor,
    );
  }

  @Delete(':id/installments/:installmentId')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Delete an unallocated installment or trim a partial installment remainder' })
  deleteInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.deleteInstallment(id, installmentId, propertyId, actor);
  }

  @Post(':id/installments/:installmentId/allocations')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Allocate a captured movement to an installment' })
  allocatePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AllocateBookingRequestPaymentDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.allocatePayment(id, installmentId, propertyId, dto, actor);
  }

  @Get(':id/payments')
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'List Booking Request movements and resolutions' })
  listPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.paymentService.listPayments(id, propertyId);
  }

  @Post(':id/payments/charge')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Manually charge the saved Booking Request card' })
  chargeSavedCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: ChargeBookingRequestCardDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.chargeSavedCard(id, propertyId, dto, actor);
  }

  @Post(':id/payments/external')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Record externally collected Booking Request money' })
  recordExternalPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RecordBookingRequestExternalPaymentDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.recordExternalPayment(id, propertyId, dto, actor);
  }

  @Post(':id/payments/:paymentId/refunds')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Partially or fully refund a request gateway payment' })
  refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RefundBookingRequestPaymentDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.refund(id, paymentId, propertyId, dto, actor);
  }

  @Post(':id/payments/:paymentId/external-returns')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Record that externally collected money was returned' })
  recordExternalReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RecordBookingRequestExternalReturnDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.recordExternalReturn(id, paymentId, propertyId, dto, actor);
  }

  @Post(':id/payments/:paymentId/retentions')
  @RequirePermissions('reservations.write')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiOperation({ summary: 'Resolve captured money as retained for denial' })
  retainForDenial(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: RetainBookingRequestPaymentDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.paymentService.retainForDenial(id, paymentId, propertyId, dto, actor);
  }
}
