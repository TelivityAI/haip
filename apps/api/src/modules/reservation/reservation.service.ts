import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  forwardRef,
} from '@nestjs/common';
import { eq, and, sql, gte, lte, inArray, isNull } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { reservations, bookings, guests, rooms, roomTypes, ratePlans, properties, payments } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { assertTransition, type ReservationStatus } from './reservation-state-machine';
import { AvailabilityService } from './availability.service';
import { FolioService } from '../folio/folio.service';
import { RoomStatusService } from '../room/room-status.service';
import { PaymentService } from '../payment/payment.service';
import { WebhookService } from '../webhook/webhook.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ModifyReservationDto } from './dto/modify-reservation.dto';
import { AssignRoomDto } from './dto/assign-room.dto';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { ListReservationsDto } from './dto/list-reservations.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { GroupCheckInDto } from './dto/group-check-in.dto';
import { BulkActionDto } from './dto/bulk-action.dto';
import { ListUnassignedDto } from './dto/list-unassigned.dto';
import { randomUUID, createCipheriv, randomBytes } from 'crypto';

@Injectable()
export class ReservationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly availabilityService: AvailabilityService,
    @Inject(forwardRef(() => FolioService)) private readonly folioService: FolioService,
    private readonly roomStatusService: RoomStatusService,
    private readonly paymentService: PaymentService,
    private readonly webhookService: WebhookService,
  ) {}

  async create(dto: CreateReservationDto, opts?: { confirmationNumber?: string }) {
    // Check guest is not DNR
    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, dto.guestId));
    if (!guest) {
      throw new NotFoundException(`Guest ${dto.guestId} not found`);
    }
    if (guest.isDnr) {
      throw new BadRequestException(
        `Guest ${dto.guestId} is on the Do Not Rent list: ${guest.dnrReason ?? 'No reason given'}`,
      );
    }

    // Calculate nights
    const arrival = new Date(dto.arrivalDate);
    const departure = new Date(dto.departureDate);
    const nights = Math.ceil(
      (departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (nights <= 0) {
      throw new BadRequestException('Departure date must be after arrival date');
    }

    // Generate confirmation number. Callers that expose it to guests as a bearer
    // credential (e.g. the booking engine) inject a high-entropy value instead of
    // the default timestamp form, which is too low-entropy to be unguessable.
    const confirmationNumber =
      opts?.confirmationNumber ??
      `HAIP-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

    // FK ownership (security audit #4): the caller supplies roomTypeId AND
    // ratePlanId in the DTO. Without scoping these to dto.propertyId, a caller
    // at property A could reference property B's rate plan / room type and
    // leak its details back on read. Verify same-property before any insert.
    await this.assertSamePropertyFk(roomTypes, dto.roomTypeId, dto.propertyId, 'room type');
    await this.assertSamePropertyFk(ratePlans, dto.ratePlanId, dto.propertyId, 'rate plan');

    // TOCTOU: availability check + insert run inside the same transaction so the
    // race window between "there's space" and "we wrote the booking" is minimized.
    // Postgres default isolation is READ COMMITTED, so concurrent txs can still
    // double-book in theory; for stronger guarantees promote to SERIALIZABLE.
    // See Bug 5 — kept at default to avoid driver-compat surprises.
    const result = await this.db.transaction(async (tx: any) => {
      // Check inventory availability inside the tx
      const availability = await this.availabilityService.searchAvailability(
        dto.propertyId,
        dto.arrivalDate,
        dto.departureDate,
        dto.roomTypeId,
        tx,
      );
      const roomTypeAvail = availability.find((a: any) => a.roomTypeId === dto.roomTypeId);
      if (!roomTypeAvail || roomTypeAvail.available <= 0) {
        throw new BadRequestException(
          `No availability for room type ${dto.roomTypeId} on the requested dates`,
        );
      }

      const [booking] = await tx
        .insert(bookings)
        .values({
          propertyId: dto.propertyId,
          guestId: dto.guestId,
          confirmationNumber,
          externalConfirmation: dto.externalConfirmation,
          source: dto.source,
          channelCode: dto.channelCode,
        })
        .returning();

      const [reservation] = await tx
        .insert(reservations)
        .values({
          propertyId: dto.propertyId,
          bookingId: booking.id,
          guestId: dto.guestId,
          arrivalDate: dto.arrivalDate,
          departureDate: dto.departureDate,
          nights,
          roomTypeId: dto.roomTypeId,
          ratePlanId: dto.ratePlanId,
          totalAmount: dto.totalAmount,
          currencyCode: dto.currencyCode,
          adults: dto.adults ?? 1,
          children: dto.children ?? 0,
          specialRequests: dto.specialRequests,
          status: 'pending',
        })
        .returning();

      return { ...reservation, booking };
    });

    // Emit reservation.created so channel manager / ARI can push updated availability.
    await this.webhookService.emit(
      'reservation.created',
      'reservation',
      result.id,
      {
        reservationId: result.id,
        arrivalDate: result.arrivalDate,
        departureDate: result.departureDate,
        roomTypeId: result.roomTypeId,
      },
      dto.propertyId,
    );

    return result;
  }

  async confirm(id: string, propertyId: string) {
    const reservation = await this.findByIdRaw(id, propertyId);
    // UX: short-circuit with a clear error for callers passing stale state.
    assertTransition(reservation.status as ReservationStatus, 'confirmed');

    // Bug 2: actual state change is an atomic conditional update. Two
    // concurrent confirms can both pass assertTransition but only one
    // can flip status=pending → status=confirmed.
    const updated = await this.claimTransition(
      id,
      propertyId,
      ['pending'],
      { status: 'confirmed', updatedAt: new Date() },
      'confirmed',
    );
    return updated;
  }

  async assignRoom(id: string, propertyId: string, dto: AssignRoomDto) {
    const reservation = await this.findByIdRaw(id, propertyId);
    assertTransition(reservation.status as ReservationStatus, 'assigned');

    // Verify room exists, belongs to same property, and matches room type
    const [room] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, dto.roomId), eq(rooms.propertyId, reservation.propertyId)));
    if (!room) {
      throw new NotFoundException(`Room ${dto.roomId} not found in this property`);
    }
    if (room.roomTypeId !== reservation.roomTypeId) {
      throw new BadRequestException(
        `Room ${dto.roomId} is type ${room.roomTypeId}, but reservation requires type ${reservation.roomTypeId}`,
      );
    }

    const allowedStatuses = ['guest_ready', 'vacant_clean'];
    if (!allowedStatuses.includes(room.status)) {
      throw new BadRequestException(
        `Room ${dto.roomId} is not available (status: ${room.status}). Must be 'guest_ready' or 'vacant_clean'.`,
      );
    }

    // Bug 2: atomic claim — only one assign can win the race on the same
    // reservation, and only from states the state machine allows.
    const updated = await this.claimTransition(
      id,
      propertyId,
      ['confirmed'],
      { roomId: dto.roomId, status: 'assigned', updatedAt: new Date() },
      'assigned',
    );
    return updated;
  }

  // DELIBERATE NON-FEATURE (KB §14.8): there is intentionally NO un-cancel /
  // status-reversion method. Reverting a cancelled/inactive reservation back to
  // active is a payment-integrity hazard (released/refunded deposits, expired
  // auths cannot be silently reinstated). The correct workflow is to create a
  // NEW reservation. Do not add uncancel()/reactivate() here.
  async cancel(id: string, propertyId: string, dto: CancelReservationDto) {
    const reservation = await this.findByIdRaw(id, propertyId);
    assertTransition(reservation.status as ReservationStatus, 'cancelled');

    // Bug 2: conditional claim prevents double-cancel races. Allowed from
    // any pre-check-in state per the state machine.
    const updated = await this.claimTransition(
      id,
      propertyId,
      ['pending', 'confirmed', 'assigned'],
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: dto.cancellationReason,
        updatedAt: new Date(),
      },
      'cancelled',
    );

    // Emit reservation.cancelled so channel manager / ARI can push updated availability.
    await this.webhookService.emit(
      'reservation.cancelled',
      'reservation',
      updated.id,
      {
        reservationId: updated.id,
        arrivalDate: updated.arrivalDate,
        departureDate: updated.departureDate,
        roomTypeId: updated.roomTypeId,
        cancellationReason: dto.cancellationReason,
      },
      updated.propertyId,
    );

    return updated;
  }

  async markNoShow(id: string, propertyId: string) {
    const reservation = await this.findByIdRaw(id, propertyId);
    assertTransition(reservation.status as ReservationStatus, 'no_show');

    // Bug 2: atomic claim — only valid from confirmed/assigned per the SM.
    const updated = await this.claimTransition(
      id,
      propertyId,
      ['confirmed', 'assigned'],
      { status: 'no_show', updatedAt: new Date() },
      'no_show',
    );
    return updated;
  }

  async checkIn(id: string, propertyId: string, dto: CheckInDto = {}) {
    const reservation = await this.findByIdRaw(id, propertyId);
    assertTransition(reservation.status as ReservationStatus, 'checked_in');

    // DNR check
    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, reservation.guestId));
    if (guest?.isDnr) {
      throw new BadRequestException(
        `Cannot check in: guest is on the Do Not Rent list`,
      );
    }

    // Room validation
    const roomId = dto.roomId ?? reservation.roomId;
    if (dto.roomId) {
      const [room] = await this.db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, dto.roomId), eq(rooms.propertyId, reservation.propertyId)));
      if (!room) {
        throw new NotFoundException(`Room ${dto.roomId} not found in this property`);
      }
      if (room.roomTypeId !== reservation.roomTypeId) {
        throw new BadRequestException(
          `Room ${dto.roomId} is type ${room.roomTypeId}, but reservation requires type ${reservation.roomTypeId}`,
        );
      }
      const allowedStatuses = ['guest_ready', 'vacant_clean'];
      if (!allowedStatuses.includes(room.status)) {
        throw new BadRequestException(
          `Room ${dto.roomId} is not available (status: ${room.status})`,
        );
      }
    }
    if (!roomId) {
      throw new BadRequestException(
        'No room assigned — assign a room first or provide roomId',
      );
    }

    // ID capture (encrypted)
    let guestIdDocument: Record<string, string> | undefined;
    if (dto.idNumber) {
      const encrypted = this.encryptIdNumber(dto.idNumber);
      guestIdDocument = {
        type: dto.idType ?? 'unknown',
        encryptedNumber: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        country: dto.idCountry ?? '',
        expiry: dto.idExpiry ?? '',
      };
    }

    // Early check-in detection
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, reservation.propertyId));
    const now = new Date();
    let isEarlyCheckin = false;
    let earlyCheckinFee: string | undefined;

    if (property) {
      const checkInTime = property.checkInTime ?? '15:00';
      const [hours, minutes] = checkInTime.split(':').map(Number);
      const propertyNow = new Date(
        now.toLocaleString('en-US', { timeZone: property.timezone ?? 'UTC' }),
      );
      const standardCheckIn = new Date(propertyNow);
      standardCheckIn.setHours(hours, minutes, 0, 0);

      if (propertyNow < standardCheckIn) {
        isEarlyCheckin = true;
        const settings = property.settings as any;
        if (settings?.earlyCheckInFee && settings.earlyCheckInFee > 0) {
          earlyCheckinFee = String(settings.earlyCheckInFee);
        }
      }
    }

    // Update reservation
    const updateData: Record<string, unknown> = {
      status: 'checked_in',
      checkedInAt: now,
      actualArrivalTime: now,
      roomId,
      isEarlyCheckin,
      updatedAt: now,
    };
    if (guestIdDocument) updateData['guestIdDocument'] = guestIdDocument;
    if (earlyCheckinFee) updateData['earlyCheckinFee'] = earlyCheckinFee;
    if (dto.registrationSigned) updateData['registrationSignedAt'] = now;
    if (dto.specialRequests) {
      updateData['specialRequests'] = reservation.specialRequests
        ? `${reservation.specialRequests}\n${dto.specialRequests}`
        : dto.specialRequests;
    }

    // Bug 2: atomic claim — only assigned reservations may check in, and
    // only one concurrent check-in can win. Side effects (folio, payment,
    // room transition, webhook) run ONLY if the claim succeeded.
    const updated = await this.claimTransition(
      id,
      propertyId,
      ['assigned'],
      updateData,
      'checked_in',
    );

    // Auto-create guest folio on check-in
    const folio = await this.folioService.createAutoFolio(updated);

    // Post early check-in fee to folio
    if (earlyCheckinFee) {
      await this.folioService.postCharge(folio.id, {
        propertyId: reservation.propertyId,
        type: 'fee',
        description: 'Early check-in fee',
        amount: earlyCheckinFee,
        currencyCode: reservation.currencyCode,
        serviceDate: now.toISOString(),
      });
    }

    // Deposit authorization (if token provided and not skipped)
    // Accept paymentMethodId (Stripe Elements) as alias for gatewayPaymentToken
    const paymentToken = dto.paymentMethodId ?? dto.gatewayPaymentToken;
    let depositAuth: unknown = null;
    if (!dto.skipDepositAuth && paymentToken) {
      const depositAmount = dto.depositAmount
        ? String(dto.depositAmount)
        : new Decimal(reservation.totalAmount).times('1.2').toFixed(2);
      try {
        depositAuth = await this.paymentService.authorizePayment({
          folioId: folio.id,
          propertyId: reservation.propertyId,
          amount: depositAmount,
          currencyCode: reservation.currencyCode,
          gatewayProvider: dto.gatewayProvider ?? 'stripe',
          gatewayPaymentToken: paymentToken,
          cardLastFour: dto.cardLastFour,
          cardBrand: dto.cardBrand,
        });
      } catch {
        // Deposit auth failure does not block check-in
      }
    }

    // Mark room occupied
    await this.roomStatusService.markOccupied(roomId, reservation.propertyId);

    // Emit webhook
    await this.webhookService.emit(
      'reservation.checked_in',
      'reservation',
      updated.id,
      { roomId, folioId: folio.id, isEarlyCheckin },
      reservation.propertyId,
    );

    return { reservation: updated, folio, depositAuth };
  }

  async checkOut(id: string, propertyId: string, dto: CheckOutDto = {}) {
    const reservation = await this.findByIdRaw(id, propertyId);
    assertTransition(reservation.status as ReservationStatus, 'checked_out');

    const now = new Date();

    // Late checkout detection (read-only)
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, reservation.propertyId));

    let isLateCheckout = false;
    let lateCheckoutFeeAmount: string | undefined;

    if (property) {
      const checkOutTime = property.checkOutTime ?? '11:00';
      const [hours, minutes] = checkOutTime.split(':').map(Number);
      const propertyNow = new Date(
        now.toLocaleString('en-US', { timeZone: property.timezone ?? 'UTC' }),
      );
      const standardCheckOut = new Date(propertyNow);
      standardCheckOut.setHours(hours, minutes, 0, 0);

      if (propertyNow > standardCheckOut) {
        isLateCheckout = true;
        const fee = dto.lateCheckoutFee ?? (property.settings as any)?.lateCheckoutFee;
        if (fee && fee > 0) {
          lateCheckoutFeeAmount = String(fee);
        }
      }
    }

    const folioResult = await this.folioService.list({
      propertyId: reservation.propertyId,
      reservationId: reservation.id,
      page: 1,
      limit: 100,
    });
    const folios = folioResult.data;

    // Express checkout: post late fee before balance validation so settle sees zero.
    if (dto.expressCheckout && lateCheckoutFeeAmount && folios.length > 0) {
      const openFolio = folios.find((f: any) => f.status === 'open');
      if (openFolio) {
        await this.folioService.postCharge(openFolio.id, {
          propertyId: reservation.propertyId,
          type: 'fee',
          description: 'Late checkout fee',
          amount: lateCheckoutFeeAmount,
          currencyCode: reservation.currencyCode,
          serviceDate: now.toISOString(),
        });
      }
    }

    // Express checkout: validate balances before claiming the transition.
    if (dto.expressCheckout) {
      for (const folio of folios) {
        if (folio.status !== 'open') continue;
        const refreshed = await this.folioService.findById(folio.id, reservation.propertyId);
        if (new Decimal(refreshed.balance).abs().gt('0.01')) {
          throw new BadRequestException(
            `Cannot express checkout: folio ${folio.folioNumber} has outstanding balance of ${refreshed.balance}`,
          );
        }
      }
    }

    const updateData: Record<string, unknown> = {
      status: 'checked_out',
      checkedOutAt: now,
      actualDepartureTime: now,
      isLateCheckout,
      updatedAt: now,
    };
    if (lateCheckoutFeeAmount) updateData['lateCheckoutFee'] = lateCheckoutFeeAmount;

    const updated = await this.claimTransition(
      id,
      propertyId,
      ['checked_in', 'stayover', 'due_out'],
      updateData,
      'checked_out',
    );

    const folioSummary: Array<{ folioId: string; balance: string; status: string }> = [];

    if (!dto.expressCheckout && lateCheckoutFeeAmount && folios.length > 0) {
      const openFolio = folios.find((f: any) => f.status === 'open');
      if (openFolio) {
        await this.folioService.postCharge(openFolio.id, {
          propertyId: reservation.propertyId,
          type: 'fee',
          description: 'Late checkout fee',
          amount: lateCheckoutFeeAmount,
          currencyCode: reservation.currencyCode,
          serviceDate: now.toISOString(),
        });
      }
    }

    if (dto.expressCheckout) {
      for (const folio of folios) {
        if (folio.status !== 'open') continue;

        const authorizedPayments = await this.db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.folioId, folio.id),
              eq(payments.propertyId, reservation.propertyId),
              eq(payments.status, 'authorized' as any),
            ),
          );

        for (const payment of authorizedPayments) {
          try {
            await this.paymentService.capturePayment(payment.id, reservation.propertyId);
          } catch {
            // Continue with other payments
          }
        }
      }

      for (const folio of folios) {
        if (folio.status !== 'open') continue;
        await this.folioService.settle(folio.id, reservation.propertyId);
        folioSummary.push({ folioId: folio.id, balance: '0.00', status: 'settled' });
      }
    } else {
      for (const folio of folios) {
        folioSummary.push({
          folioId: folio.id,
          balance: folio.balance,
          status: folio.status,
        });
      }

      for (const folio of folios) {
        const authorizedPayments = await this.db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.folioId, folio.id),
              eq(payments.propertyId, reservation.propertyId),
              eq(payments.status, 'authorized' as any),
            ),
          );
        for (const payment of authorizedPayments) {
          try {
            await this.paymentService.voidPayment(payment.id, reservation.propertyId);
          } catch {
            // Don't block checkout
          }
        }
      }
    }

    if (reservation.roomId) {
      await this.roomStatusService.markVacantDirty(reservation.roomId, reservation.propertyId);
    }

    await this.webhookService.emit(
      'reservation.checked_out',
      'reservation',
      updated.id,
      { isLateCheckout, expressCheckout: dto.expressCheckout ?? false },
      reservation.propertyId,
    );

    return { reservation: updated, folioSummary };
  }

  async expressCheckOut(id: string, propertyId: string) {
    return this.checkOut(id, propertyId, { expressCheckout: true });
  }

  async groupCheckIn(propertyId: string, dto: GroupCheckInDto) {
    const results: Array<{
      reservationId: string;
      success: boolean;
      data?: unknown;
      error?: string;
    }> = [];

    // Validate all reservations belong to the same property.
    // findByIdRaw is scoped by propertyId, and we also double-check the returned
    // row's propertyId defensively for a clearer error message.
    for (const item of dto.reservations) {
      let reservation: any;
      try {
        reservation = await this.findByIdRaw(item.reservationId, propertyId);
      } catch {
        throw new BadRequestException(
          `Reservation ${item.reservationId} does not belong to property ${propertyId}`,
        );
      }
      if (reservation.propertyId !== propertyId) {
        throw new BadRequestException(
          `Reservation ${item.reservationId} does not belong to property ${propertyId}`,
        );
      }
    }

    // Process each check-in individually
    for (const item of dto.reservations) {
      try {
        // KB state machine (pending → confirmed → assigned → checked_in): a
        // still-confirmed reservation must be assigned a room before it can
        // check in. Assign first using the provided override or its
        // pre-assigned room, then check in.
        const reservation = await this.findByIdRaw(item.reservationId, propertyId);
        if (reservation.status === 'confirmed') {
          const roomToAssign = item.roomId ?? reservation.roomId ?? undefined;
          if (!roomToAssign) {
            throw new BadRequestException(
              `Reservation ${item.reservationId} has no room assigned — provide a roomId`,
            );
          }
          await this.assignRoom(item.reservationId, propertyId, { roomId: roomToAssign });
        }
        const result = await this.checkIn(item.reservationId, propertyId, {
          roomId: item.roomId,
          skipDepositAuth: item.skipDepositAuth,
        });
        results.push({ reservationId: item.reservationId, success: true, data: result });
      } catch (err: any) {
        results.push({
          reservationId: item.reservationId,
          success: false,
          error: err.message ?? 'Unknown error',
        });
      }
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Bulk lifecycle action (Tier 4 — Reservation Operations Polish).
   *
   * Applies one action to many reservations, reusing the existing per-reservation
   * checkIn/checkOut/cancel methods (so all multi-tenancy + state-machine
   * guarantees hold). Each id runs in its own try/catch — a single failure (e.g.
   * check-out blocked by an outstanding balance) is captured in the per-id result
   * and NEVER aborts the batch.
   *
   * Deferred: 'add_payment' is intentionally not supported here (out of scope to
   * keep the action set tight; use the payment/folio endpoints directly).
   */
  async bulkAction(propertyId: string, dto: BulkActionDto) {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of dto.ids) {
      try {
        switch (dto.action) {
          case 'check_in':
            await this.checkIn(id, propertyId, {});
            break;
          case 'check_out':
            // A surfaced error (e.g. outstanding balance on express checkout) is
            // captured per-id below as a warning rather than aborting the batch.
            await this.checkOut(id, propertyId, {});
            break;
          case 'cancel':
            await this.cancel(id, propertyId, { cancellationReason: dto.reason });
            break;
        }
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message ?? 'Unknown error' });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    await this.webhookService.emit(
      'reservation.bulk_action_completed',
      'reservation',
      propertyId,
      { action: dto.action, total: results.length, succeeded, failed },
      propertyId,
    );

    return { results, succeeded, failed };
  }

  /**
   * Unassigned-reservation finder (Tier 4 — Reservation Operations Polish).
   *
   * Returns reservations that are assignable-but-unassigned (status confirmed or
   * assigned, no room linked yet) for an optional arrival-date window. Reuses the
   * leftJoin shape from list() for guest/room-type display fields, tenant-scoped
   * by propertyId.
   */
  async findUnassigned(dto: ListUnassignedDto) {
    const conditions: any[] = [
      eq(reservations.propertyId, dto.propertyId),
      isNull(reservations.roomId),
      inArray(reservations.status, ['confirmed', 'assigned'] as any),
    ];
    if (dto.from) {
      conditions.push(gte(reservations.arrivalDate, dto.from));
    }
    if (dto.to) {
      conditions.push(lte(reservations.arrivalDate, dto.to));
    }

    const whereClause = and(...conditions);

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          reservation: reservations,
          guestFirstName: guests.firstName,
          guestLastName: guests.lastName,
          roomTypeName: roomTypes.name,
        })
        .from(reservations)
        .leftJoin(guests, eq(reservations.guestId, guests.id))
        .leftJoin(roomTypes, eq(reservations.roomTypeId, roomTypes.id))
        .where(whereClause)
        .orderBy(reservations.arrivalDate),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(reservations)
        .where(whereClause),
    ]);

    const data = rows.map((r: any) => ({
      ...r.reservation,
      guestName: r.guestFirstName ? `${r.guestFirstName} ${r.guestLastName}` : null,
      roomTypeName: r.roomTypeName,
      reasonHint: 'no_room_assigned',
    }));

    return { data, total: Number(countResult[0]?.count ?? 0) };
  }

  async modify(id: string, propertyId: string, dto: ModifyReservationDto) {
    const reservation = await this.findByIdRaw(id, propertyId);

    // Can only modify before check-out
    const nonModifiable: ReservationStatus[] = ['checked_out', 'no_show', 'cancelled'];
    if (nonModifiable.includes(reservation.status as ReservationStatus)) {
      throw new BadRequestException(
        `Cannot modify reservation in '${reservation.status}' status`,
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const arrivalChanged = dto.arrivalDate && dto.arrivalDate !== reservation.arrivalDate;
    const departureChanged = dto.departureDate && dto.departureDate !== reservation.departureDate;
    const roomTypeChanged = dto.roomTypeId && dto.roomTypeId !== reservation.roomTypeId;

    if (dto.arrivalDate || dto.departureDate) {
      const arrival = dto.arrivalDate ?? reservation.arrivalDate;
      const departure = dto.departureDate ?? reservation.departureDate;
      const nights = Math.ceil(
        (new Date(departure).getTime() - new Date(arrival).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (nights <= 0) {
        throw new BadRequestException('Departure date must be after arrival date');
      }
      if (dto.arrivalDate) updates['arrivalDate'] = dto.arrivalDate;
      if (dto.departureDate) updates['departureDate'] = dto.departureDate;
      updates['nights'] = nights;
    }

    // FK ownership (security audit #4): if the caller is moving the reservation
    // to a different room type or rate plan, verify each FK belongs to the same
    // tenant before the update.
    if (dto.roomTypeId) {
      await this.assertSamePropertyFk(roomTypes, dto.roomTypeId, propertyId, 'room type');
      updates['roomTypeId'] = dto.roomTypeId;
    }
    if (dto.ratePlanId) {
      await this.assertSamePropertyFk(ratePlans, dto.ratePlanId, propertyId, 'rate plan');
      updates['ratePlanId'] = dto.ratePlanId;
    }
    if (dto.totalAmount) updates['totalAmount'] = dto.totalAmount;
    if (dto.adults !== undefined) updates['adults'] = dto.adults;
    if (dto.children !== undefined) updates['children'] = dto.children;
    if (dto.specialRequests !== undefined)
      updates['specialRequests'] = dto.specialRequests;

    // If dates or room type change, re-check availability on the new window.
    // The existing reservation still occupies its old window (and room type) in searchAvailability,
    // so if roomType is unchanged we must exclude it from the count to avoid blocking itself on overlap.
    //
    // TOCTOU: we run the availability check and the update inside the same transaction
    // so concurrent writers cannot slip between them. Postgres' default isolation
    // (READ COMMITTED) still permits some overlap, but the race window is minimized.
    // For stricter guarantees, raise the transaction to SERIALIZABLE — not done here
    // to avoid breakage with drizzle-orm's postgres-js driver; see Bug 5.
    const updated = await this.db.transaction(async (tx: any) => {
      if (arrivalChanged || departureChanged || roomTypeChanged) {
        const newArrival = (dto.arrivalDate ?? reservation.arrivalDate) as string;
        const newDeparture = (dto.departureDate ?? reservation.departureDate) as string;
        const newRoomTypeId = (dto.roomTypeId ?? reservation.roomTypeId) as string;

        const availability = await this.availabilityService.searchAvailability(
          reservation.propertyId,
          newArrival,
          newDeparture,
          newRoomTypeId,
          tx,
        );

        // Check each night in the requested window has availability.
        // If the reservation currently occupies the same room type and overlaps the new window,
        // it was counted as "sold" — give it back one unit when evaluating.
        const currentCountsItself = !roomTypeChanged &&
          reservation.arrivalDate < newDeparture &&
          reservation.departureDate > newArrival;

        const nightsOk = availability
          .filter((a: any) => a.roomTypeId === newRoomTypeId)
          .every((a: any) => {
            const existingOccupiesThisNight =
              currentCountsItself &&
              (reservation.arrivalDate as string) <= a.date &&
              (reservation.departureDate as string) > a.date;
            const effectiveAvailable = a.available + (existingOccupiesThisNight ? 1 : 0);
            return effectiveAvailable > 0;
          });

        if (!nightsOk) {
          throw new ConflictException(
            `No availability for room type ${newRoomTypeId} on ${newArrival} → ${newDeparture}`,
          );
        }
      }

      const [row] = await tx
        .update(reservations)
        .set(updates)
        .where(
          and(eq(reservations.id, id), eq(reservations.propertyId, propertyId)),
        )
        .returning();
      return row;
    });

    // Emit reservation.modified so channel manager / ARI can push updated availability.
    await this.webhookService.emit(
      'reservation.modified',
      'reservation',
      updated.id,
      {
        reservationId: updated.id,
        arrivalDate: updated.arrivalDate,
        departureDate: updated.departureDate,
        roomTypeId: updated.roomTypeId,
        previousArrivalDate: reservation.arrivalDate,
        previousDepartureDate: reservation.departureDate,
        previousRoomTypeId: reservation.roomTypeId,
      },
      updated.propertyId,
    );

    return updated;
  }

  async findById(id: string, propertyId: string) {
    // Join with guest, room type, rate plan, and room (if assigned).
    // Tenant-scoped via propertyId to prevent cross-tenant access.
    const results = await this.db
      .select({
        reservation: reservations,
        guest: guests,
        roomType: roomTypes,
        ratePlan: ratePlans,
        room: rooms,
      })
      .from(reservations)
      .leftJoin(guests, eq(reservations.guestId, guests.id))
      .leftJoin(roomTypes, eq(reservations.roomTypeId, roomTypes.id))
      .leftJoin(ratePlans, eq(reservations.ratePlanId, ratePlans.id))
      .leftJoin(rooms, eq(reservations.roomId, rooms.id))
      .where(
        and(eq(reservations.id, id), eq(reservations.propertyId, propertyId)),
      );

    if (!results.length) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }

    return results[0];
  }

  async list(dto: ListReservationsDto) {
    // propertyId is required by the DTO — always tenant-scope.
    const conditions: any[] = [eq(reservations.propertyId, dto.propertyId)];

    if (dto.status) {
      conditions.push(eq(reservations.status, dto.status as any));
    }
    if (dto.guestId) {
      conditions.push(eq(reservations.guestId, dto.guestId));
    }
    if (dto.arrivalDateFrom) {
      conditions.push(gte(reservations.arrivalDate, dto.arrivalDateFrom));
    }
    if (dto.arrivalDateTo) {
      conditions.push(lte(reservations.arrivalDate, dto.arrivalDateTo));
    }
    if (dto.departureDateFrom) {
      conditions.push(gte(reservations.departureDate, dto.departureDateFrom));
    }
    if (dto.departureDateTo) {
      conditions.push(lte(reservations.departureDate, dto.departureDateTo));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          reservation: reservations,
          guestFirstName: guests.firstName,
          guestLastName: guests.lastName,
          roomNumber: rooms.number,
          roomTypeName: roomTypes.name,
          ratePlanName: ratePlans.name,
        })
        .from(reservations)
        .leftJoin(guests, eq(reservations.guestId, guests.id))
        .leftJoin(rooms, eq(reservations.roomId, rooms.id))
        .leftJoin(roomTypes, eq(reservations.roomTypeId, roomTypes.id))
        .leftJoin(ratePlans, eq(reservations.ratePlanId, ratePlans.id))
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(reservations.arrivalDate),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(reservations)
        .where(whereClause),
    ]);

    const data = rows.map((r: any) => ({
      ...r.reservation,
      guestName: r.guestFirstName ? `${r.guestFirstName} ${r.guestLastName}` : null,
      roomNumber: r.roomNumber,
      roomTypeName: r.roomTypeName,
      ratePlanName: r.ratePlanName,
    }));

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  /**
   * Atomic state-machine transition (Bug 2, PR-A pattern).
   *
   * Emits a conditional UPDATE that only matches rows currently in one of
   * `allowedFromStatuses`. If the update matches zero rows, we look up the
   * current state and raise ConflictException (or NotFoundException if the
   * row disappeared). This removes the read-then-write race where two
   * concurrent transitions could both pass a prior assertTransition() call.
   */
  private async claimTransition(
    id: string,
    propertyId: string,
    allowedFromStatuses: ReservationStatus[],
    updateData: Record<string, unknown>,
    targetStatus: ReservationStatus,
  ) {
    const statusCondition = allowedFromStatuses.length === 1
      ? eq(reservations.status, allowedFromStatuses[0]! as any)
      : inArray(reservations.status, allowedFromStatuses as any);

    const claimed = await this.db
      .update(reservations)
      .set(updateData)
      .where(
        and(
          eq(reservations.id, id),
          eq(reservations.propertyId, propertyId),
          statusCondition,
        ),
      )
      .returning();

    if (claimed && claimed.length > 0) {
      return claimed[0];
    }

    // Claim failed — either gone, wrong tenant, or wrong state. Distinguish.
    const [current] = await this.db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.id, id), eq(reservations.propertyId, propertyId)),
      );
    if (!current) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    throw new ConflictException(
      `Cannot transition reservation from '${current.status}' to '${targetStatus}' ` +
      `(concurrent modification? expected one of: ${allowedFromStatuses.join(', ')})`,
    );
  }

  /**
   * Verify a caller-supplied FK belongs to the SAME property as the request.
   * Without this, a caller at property A could pass a rate-plan / room-type id
   * from property B and the row would happily insert (the schema FK doesn't
   * enforce same-property because the FK is on the row id alone). Closes the
   * cross-tenant integrity hole flagged as #4 in the security audit.
   */
  private async assertSamePropertyFk(
    table: { id: any; propertyId: any },
    id: string,
    propertyId: string,
    label: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`${label} ${id} not found in this property`);
    }
  }

  private async findByIdRaw(id: string, propertyId: string) {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.id, id), eq(reservations.propertyId, propertyId)),
      );
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  private encryptIdNumber(plainText: string): { encrypted: string; iv: string; authTag: string } {
    const key = process.env['ID_ENCRYPTION_KEY'];
    if (!key) {
      // If no encryption key configured, store a placeholder
      return { encrypted: '***REDACTED***', iv: '', authTag: '' };
    }
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), authTag };
  }
}
