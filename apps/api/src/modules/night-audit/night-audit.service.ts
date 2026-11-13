import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, inArray, sql, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  auditRuns,
  bookings,
  reservations,
  folios,
  charges,
  ratePlans,
  properties,
  rooms,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { withAcceptedPricingLock } from '../../common/database/accepted-pricing-lock';
import { FolioService } from '../folio/folio.service';
import { ReservationService } from '../reservation/reservation.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { RoomStatusService } from '../room/room-status.service';
import { WebhookService } from '../webhook/webhook.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { PolicyService } from '../policy/policy.service';
import { DepositSettlementService } from '../accounting/deposit-settlement.service';
import { RunAuditDto } from './dto/run-audit.dto';
import { calendarDay, stayCoversBusinessDate, addCalendarDays } from './night-audit-clock';
import type {
  AuditRunResult,
  TariffResult,
  NoShowResult,
  RevenueSummary,
} from './dto/audit-report.dto';

@Injectable()
export class NightAuditService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly folioService: FolioService,
    private readonly reservationService: ReservationService,
    private readonly housekeepingService: HousekeepingService,
    private readonly roomStatusService: RoomStatusService,
    private readonly webhookService: WebhookService,
    private readonly ancillaryService: AncillaryService,
    private readonly policyService: PolicyService,
    private readonly depositSettlementService: DepositSettlementService,
  ) {}

  /**
   * Main night audit orchestrator (KB 5.8).
   * Idempotent — re-running for same date returns existing result.
   */
  async runAudit(dto: RunAuditDto): Promise<AuditRunResult> {
    // Bug 4: concurrency-safe idempotency via unique (property_id, business_date).
    // Attempt to insert; if the row already exists, classify by status:
    //   completed -> ConflictException (already done)
    //   running/pending -> return as active audit (alreadyRun: true)
    const auditRun = await this.createOrGetAuditRun(dto.propertyId, dto.businessDate);
    if (auditRun._preexisting) {
      delete auditRun._preexisting;
      if (auditRun.status === 'completed') {
        throw new ConflictException(
          `Night audit for ${dto.businessDate} already completed`,
        );
      }
      // status === 'running' (pending equivalent) — treat as active audit
      return { alreadyRun: true, auditRun };
    }

    // 3. Emit audit.started webhook
    await this.webhookService.emit(
      'audit.started',
      'audit_run',
      auditRun.id,
      { businessDate: dto.businessDate },
      dto.propertyId,
    );

    try {
      if (dto.mode === 'unattended') {
        await this.maybeAutoExtendOverdueStays(dto.propertyId, dto.businessDate);
      }

      // 4. Post room tariffs to in-house stays that cover this business date
      const tariffResult = await this.postRoomTariffs(dto.propertyId, dto.businessDate);

      // Post per-night stay extras (idempotent per service + business date)
      const serviceTariffResult = await this.ancillaryService.postPerNightForProperty(
        dto.propertyId,
        dto.businessDate,
      );

      // 5. Process no-shows
      const noShowResult = await this.processNoShows(dto.propertyId, dto.businessDate);

      // 6. Generate stayover housekeeping tasks for next day
      const nextDay = this.addDays(dto.businessDate, 1);
      await this.housekeepingService.generateStayoverTasks(dto.propertyId, nextDay);

      // 7. Advance stayover reservations (checked_in -> stayover)
      await this.advanceStayovers(dto.propertyId, dto.businessDate);

      // 8. Mark due-outs (departure date = business date + 1, still in-house)
      await this.markDueOuts(dto.propertyId, dto.businessDate);

      // Stays still in house on or after departure. The date still rolls.
      const overdueWarnings = await this.collectOverdueDepartureWarnings(
        dto.propertyId,
        dto.businessDate,
      );

      // 9. Lock charges for the business date
      await this.lockChargesForDate(dto.propertyId, dto.businessDate);

      // 10. Generate revenue summary
      const baseSummary = await this.generateRevenueSummary(dto.propertyId, dto.businessDate);
      const summary = {
        ...baseSummary,
        mode: dto.mode ?? 'manual',
        overdueDeparturesCount: overdueWarnings.length,
      };

      // 11. Complete audit run
      const completed = await this.completeAuditRun(auditRun.id, {
        roomChargesPosted: tariffResult.totalRoom,
        taxChargesPosted: tariffResult.totalTax,
        noShowsProcessed: String(noShowResult.count),
        summary,
        errors: [
          ...tariffResult.errors,
          ...noShowResult.errors,
          ...overdueWarnings,
          ...(serviceTariffResult.errors ?? []).map(
            (e: { id?: string; message: string }) => ({
              message: e.message,
              entity: e.id,
            }),
          ),
        ],
      });

      // 12. Emit audit.completed webhook
      await this.webhookService.emit(
        'audit.completed',
        'audit_run',
        auditRun.id,
        { businessDate: dto.businessDate, summary },
        dto.propertyId,
      );

      return { alreadyRun: false, auditRun: completed };
    } catch (error) {
      await this.failAuditRun(auditRun.id, error);
      throw error;
    }
  }

  /**
   * Post room tariffs to all in-house folios (KB 5.8).
   * Posts room charge + separate tax charge per reservation.
   */
  async postRoomTariffs(propertyId: string, businessDate: string): Promise<TariffResult> {
    // Get all checked-in / stayover reservations
    const inHouseReservations = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.status} in ('checked_in', 'stayover', 'due_out')`,
          lte(reservations.arrivalDate, businessDate),
          sql`${reservations.departureDate} > ${businessDate}`,
        ),
      );

    // Monetary totals via Decimal to preserve precision
    let totalRoom = new Decimal(0);
    let totalTax = new Decimal(0);
    let count = 0;
    const errors: Array<{ message: string; entity?: string }> = [];

    for (const reservation of inHouseReservations) {
      try {
        if (!stayCoversBusinessDate(reservation.arrivalDate, reservation.departureDate, businessDate)) {
          continue;
        }
        if (reservation.acceptedPricingSnapshot) {
          const lockedPost = await withAcceptedPricingLock(
            this.db,
            propertyId,
            reservation.id,
            async (tx) => {
              const [currentReservation] = await tx
                .select()
                .from(reservations)
                .where(and(
                  eq(reservations.id, reservation.id),
                  eq(reservations.propertyId, propertyId),
                  inArray(reservations.status, ['checked_in', 'stayover', 'due_out']),
                ));
              const acceptedPricing = currentReservation?.acceptedPricingSnapshot;
              const acceptedNight = acceptedPricing?.nights?.find(
                (night: { date: string }) => night.date === businessDate,
              );
              if (!currentReservation || !acceptedPricing || !acceptedNight) return null;

              const [folio] = await tx
                .select()
                .from(folios)
                .where(and(
                  eq(folios.reservationId, currentReservation.id),
                  eq(folios.propertyId, propertyId),
                  eq(folios.type, 'guest' as any),
                  eq(folios.status, 'open' as any),
                ));
              if (!folio) {
                return { missingFolio: true as const, reservation: currentReservation };
              }

              const acceptedAdjustment = acceptedPricing.adjustment?.serviceDate === businessDate
                ? {
                    amount: acceptedPricing.adjustment.amount,
                    reason: acceptedPricing.adjustment.reason,
                  }
                : undefined;
              const outcome = await this.folioService.postChargeFromSnapshotWithOutcome(
                folio.id,
                {
                  propertyId,
                  type: 'room',
                  description: `Room tariff - ${businessDate}`,
                  amount: acceptedNight.roomAmount,
                  currencyCode: acceptedPricing.currencyCode,
                  serviceDate: new Date(`${businessDate}T00:00:00Z`).toISOString(),
                  guestId: currentReservation.guestId,
                },
                acceptedNight.taxAmount,
                acceptedAdjustment,
                `accepted-pricing:reservation:${currentReservation.id}:night:${businessDate}`,
                tx,
              );
              return {
                missingFolio: false as const,
                folio,
                rate: acceptedNight.roomAmount,
                outcome,
              };
            },
          );
          if (!lockedPost) continue;
          if (lockedPost.missingFolio) {
            errors.push({
              message: `No open folio for reservation ${reservation.id}`,
              entity: reservation.id,
            });
            continue;
          }
          await this.folioService.emitSnapshotChargeWebhooks(
            lockedPost.folio.id,
            propertyId,
            lockedPost.outcome,
          );
          if (!lockedPost.outcome.wasCreated) continue;
          const acceptedTax = (lockedPost.outcome.charge.taxCharges ?? [])
            .reduce(
              (sum: Decimal, tax: any) => sum.plus(new Decimal(tax.amount)),
              new Decimal(0),
            );
          totalRoom = totalRoom.plus(new Decimal(lockedPost.rate));
          totalTax = totalTax.plus(acceptedTax);
          count++;
          continue;
        }

        // Find open guest folio
        const [folio] = await this.db
          .select()
          .from(folios)
          .where(
            and(
              eq(folios.reservationId, reservation.id),
              eq(folios.propertyId, propertyId),
              eq(folios.type, 'guest' as any),
              eq(folios.status, 'open' as any),
            ),
          );

        if (!folio) {
          errors.push({
            message: `No open folio for reservation ${reservation.id}`,
            entity: reservation.id,
          });
          continue;
        }

        const serviceDateStart = new Date(businessDate + 'T00:00:00Z');
        // Legacy live-rate postings have no stable source key, so retain the
        // historical date/type preflight only for that path.
        const [existingCharge] = await this.db
          .select({ id: charges.id })
          .from(charges)
          .where(
            and(
              eq(charges.folioId, folio.id),
              eq(charges.propertyId, propertyId),
              eq(charges.type, 'room' as any),
              eq(charges.isReversal, false),
              sql`${charges.serviceDate}::date = ${businessDate}`,
            ),
          );
        if (existingCharge) continue;

        const [ratePlan] = await this.db
          .select({ baseAmount: ratePlans.baseAmount })
          .from(ratePlans)
          .where(eq(ratePlans.id, reservation.ratePlanId));
        const rate = ratePlan
          ? ratePlan.baseAmount
          : new Decimal(reservation.totalAmount).div(reservation.nights).toFixed(2);
        const result = await this.folioService.postCharge(folio.id, {
          propertyId,
          type: 'room',
          description: `Room tariff - ${businessDate}`,
          amount: rate,
          currencyCode: reservation.currencyCode,
          serviceDate: serviceDateStart.toISOString(),
          guestId: reservation.guestId,
        });

        // Sum auto-posted tax charges via Decimal
        const taxAmountDec = (result.taxCharges ?? [])
          .reduce((sum: Decimal, tc: any) => sum.plus(new Decimal(tc.amount)), new Decimal(0));

        totalRoom = totalRoom.plus(new Decimal(rate));
        totalTax = totalTax.plus(taxAmountDec);
        count++;
      } catch (err: any) {
        errors.push({
          message: `Failed to post tariff for reservation ${reservation.id}: ${err.message}`,
          entity: reservation.id,
        });
      }
    }

    return {
      totalRoom: totalRoom.toFixed(2),
      totalTax: totalTax.toFixed(2),
      count,
      errors,
    };
  }

  /**
   * Process no-shows: mark reservations past arrival date that never checked in (KB 5.8).
   */
  async processNoShows(propertyId: string, businessDate: string): Promise<NoShowResult> {
    // Find reservations where arrival <= businessDate and still confirmed/assigned
    const noShowCandidates = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          lte(reservations.arrivalDate, businessDate),
          sql`${reservations.status} in ('confirmed', 'assigned')`,
        ),
      );

    const [property] = await this.db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const settings = (property?.settings ?? {}) as {
      noShowFeeAmount?: number;
      noShowCutoffHour?: number;
    };
    const noShowFeeAmount = settings.noShowFeeAmount;
    const cutoffHour = settings.noShowCutoffHour;

    // When cutoff hour is configured, only treat same-day arrivals as no-shows
    // after that hour (UTC). Past-arrival dates are always eligible.
    const now = new Date();
    const eligible = noShowCandidates.filter((reservation: any) => {
      if (reservation.arrivalDate < businessDate) return true;
      if (cutoffHour === undefined || cutoffHour === null) return true;
      return now.getUTCHours() >= cutoffHour;
    });

    let count = 0;
    const reservationIds: string[] = [];
    const errors: Array<{ message: string; entity?: string }> = [];

    for (const reservation of eligible) {
      try {
        // Mark as no-show (emits reservation.no_show)
        await this.reservationService.markNoShow(reservation.id, propertyId);
        reservationIds.push(reservation.id);
        count++;

        // Policy-driven deposit settlement + penalty; property noShowFeeAmount is additive
        try {
          // No-shows are past arrival — evaluate as outside the free-cancel window.
          const evaluation = await this.policyService.evaluateCancellation({
            propertyId,
            ratePlanId: reservation.ratePlanId,
            arrivalDate: reservation.arrivalDate,
            totalAmount: reservation.totalAmount,
            nights: reservation.nights ?? 1,
            now: new Date(`${reservation.arrivalDate}T23:59:59Z`),
          });
          await this.depositSettlementService.settleFromEvaluation({
            reservationId: reservation.id,
            propertyId,
            currencyCode: reservation.currencyCode,
            evaluation,
            penaltyDescription: 'No-show penalty',
            additionalFeeAmount: noShowFeeAmount,
            additionalFeeDescription: 'No-show fee',
          });
        } catch (feeErr: any) {
          errors.push({
            message: `No-show settlement failed for ${reservation.id}: ${feeErr.message}`,
            entity: reservation.id,
          });
        }

        // Free assigned room if any
        if (reservation.roomId) {
          try {
            await this.db
              .update(reservations)
              .set({ roomId: null, updatedAt: new Date() })
              .where(
                and(
                  eq(reservations.id, reservation.id),
                  eq(reservations.propertyId, propertyId),
                ),
              );
          } catch {
            // Room unassignment failure is non-critical
          }
        }
      } catch (err: any) {
        errors.push({
          message: `Failed to process no-show for ${reservation.id}: ${err.message}`,
          entity: reservation.id,
        });
      }
    }

    return { count, reservationIds, errors };
  }

  /**
   * Advance checked_in -> stayover for multi-night stays (KB 5.1).
   * Only advances reservations where checkedInAt is before the business date.
   */
  async advanceStayovers(propertyId: string, businessDate: string): Promise<{ advanced: number }> {
    const result = await this.db
      .update(reservations)
      .set({ status: 'stayover', updatedAt: new Date() })
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'checked_in' as any),
          sql`${reservations.checkedInAt}::date < ${businessDate}`,
        ),
      )
      .returning();

    return { advanced: result.length };
  }

  /**
   * Mark stayover reservations departing next day as due_out (KB 5.1).
   * Must run AFTER advanceStayovers.
   */
  async markDueOuts(propertyId: string, businessDate: string): Promise<{ markedDueOut: number }> {
    const nextDay = this.addDays(businessDate, 1);

    const result = await this.db
      .update(reservations)
      .set({ status: 'due_out', updatedAt: new Date() })
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'stayover' as any),
          eq(reservations.departureDate, nextDay),
        ),
      )
      .returning();

    return { markedDueOut: result.length };
  }

  /**
   * Unattended close only. Extends an overdue in-house stay by one night when
   * the property opted in and the same room can be held. Otherwise the stay
   * is left in place; collectOverdueDepartureWarnings records it and the
   * business date still rolls.
   */
  private async maybeAutoExtendOverdueStays(propertyId: string, businessDate: string): Promise<void> {
    const [property] = await this.db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const nightAudit = (property?.settings as { nightAudit?: { autoExtendOverdueStays?: boolean } } | null)
      ?.nightAudit;
    if (nightAudit?.autoExtendOverdueStays !== true) return;

    const overdue = await this.listOverdueDepartureStays(propertyId, businessDate);
    for (const stay of overdue) {
      if (!(await this.roomCanHoldExtraNight(propertyId, stay))) continue;
      const newDepartureDate = addCalendarDays(stay.departureDate, 1);
      const nights = Math.max(1, Number(stay.nights ?? 0) + 1);
      await this.db
        .update(reservations)
        .set({ departureDate: newDepartureDate, nights, updatedAt: new Date() })
        .where(and(eq(reservations.id, stay.id), eq(reservations.propertyId, propertyId)));
    }
  }

  private async roomCanHoldExtraNight(
    propertyId: string,
    stay: { id: string; roomId?: string | null; departureDate: string },
  ): Promise<boolean> {
    if (!stay.roomId) return false;
    const [room] = await this.db
      .select({ status: rooms.status, isActive: rooms.isActive })
      .from(rooms)
      .where(and(eq(rooms.id, stay.roomId), eq(rooms.propertyId, propertyId)));
    if (!room?.isActive) return false;
    if (room.status === 'out_of_order' || room.status === 'out_of_service') return false;

    const extraNight = calendarDay(stay.departureDate);
    const newDeparture = addCalendarDays(extraNight, 1);
    const [conflict] = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.roomId, stay.roomId),
          sql`${reservations.id} <> ${stay.id}`,
          sql`${reservations.status} in ('assigned', 'checked_in', 'stayover', 'due_out')`,
          lte(reservations.arrivalDate, extraNight),
          sql`${reservations.departureDate} > ${extraNight}`,
          sql`${reservations.arrivalDate} < ${newDeparture}`,
        ),
      )
      .limit(1);
    return !conflict;
  }

  private async listOverdueDepartureStays(propertyId: string, businessDate: string): Promise<Array<{
    id: string;
    confirmationNumber: string | null;
    arrivalDate: string;
    departureDate: string;
    status: string;
    nights: number;
    roomId: string | null;
  }>> {
    const day = calendarDay(businessDate);
    const rows = await this.db
      .select({
        id: reservations.id,
        confirmationNumber: bookings.confirmationNumber,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        status: reservations.status,
        nights: reservations.nights,
        roomId: reservations.roomId,
      })
      .from(reservations)
      .leftJoin(bookings, eq(bookings.id, reservations.bookingId))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.status} in ('checked_in', 'stayover', 'due_out')`,
          lte(reservations.departureDate, day),
        ),
      );
    return rows.map((row: {
      id: string;
      confirmationNumber?: string | null;
      arrivalDate?: string;
      departureDate?: string;
      status?: string;
      nights?: number | null;
      roomId?: string | null;
    }) => ({
      id: row.id,
      confirmationNumber: row.confirmationNumber ?? null,
      arrivalDate: calendarDay(row.arrivalDate),
      departureDate: calendarDay(row.departureDate),
      status: String(row.status ?? ''),
      nights: Number(row.nights ?? 0),
      roomId: row.roomId ?? null,
    }));
  }

  private async collectOverdueDepartureWarnings(
    propertyId: string,
    businessDate: string,
  ): Promise<Array<{ message: string; entity?: string }>> {
    const overdue = await this.listOverdueDepartureStays(propertyId, businessDate);
    return overdue.map((stay) => ({
      entity: stay.id,
      message: `overdue_departure: reservation ${stay.confirmationNumber ?? stay.id} (${stay.status}) had departureDate ${stay.departureDate} <= ${calendarDay(businessDate)} and remains checked in`,
    }));
  }

  /**
   * Lock all charges for the business date property-wide (KB 5.8).
   * Prevents post-audit modifications to closed-day folios.
   */
  async lockChargesForDate(propertyId: string, businessDate: string): Promise<{ locked: number }> {
    const auditDate = new Date(businessDate + 'T12:00:00Z');

    const result = await this.db
      .update(charges)
      .set({ isLocked: true, lockedByAuditDate: auditDate })
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.isLocked, false),
          sql`${charges.serviceDate}::date <= ${businessDate}`,
        ),
      )
      .returning();

    return { locked: result.length };
  }

  /**
   * Generate revenue summary with KPIs (KB 5.9).
   * ADR = room revenue / rooms sold
   * RevPAR = ADR x occupancy rate
   */
  async generateRevenueSummary(propertyId: string, businessDate: string): Promise<RevenueSummary> {
    // Room revenue for the date
    const [revenueResult] = await this.db
      .select({
        roomRevenue: sql<string>`coalesce(sum(case when ${charges.type} = 'room' and ${charges.isReversal} = false then ${charges.amount}::numeric else 0 end), 0)`,
        taxRevenue: sql<string>`coalesce(sum(case when ${charges.type} = 'tax' and ${charges.isReversal} = false then ${charges.amount}::numeric else 0 end), 0)`,
        totalRevenue: sql<string>`coalesce(sum(case when ${charges.isReversal} = false then ${charges.amount}::numeric else 0 end), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          sql`${charges.serviceDate}::date = ${businessDate}`,
        ),
      );

    const roomRevenueDec = new Decimal(revenueResult?.roomRevenue ?? '0');
    const taxRevenueDec = new Decimal(revenueResult?.taxRevenue ?? '0');
    const totalRevenueDec = new Decimal(revenueResult?.totalRevenue ?? '0');
    const roomRevenue = roomRevenueDec.toNumber();
    const taxRevenue = taxRevenueDec.toNumber();
    const totalRevenue = totalRevenueDec.toNumber();

    // Rooms sold (in-house reservations)
    const [roomsSoldResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.status} in ('checked_in', 'stayover', 'due_out')`,
          lte(reservations.arrivalDate, businessDate),
          sql`${reservations.departureDate} > ${businessDate}`,
        ),
      );
    const roomsSold = roomsSoldResult?.count ?? 0;

    // Total available rooms. Active room rows win over a drifted total_rooms.
    const [propertyData] = await this.db
      .select({ totalRooms: properties.totalRooms })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const propertyTotal = propertyData?.totalRooms ?? 0;

    // OOO/OOS rooms
    const roomSummary = await this.roomStatusService.getPropertyRoomSummary(propertyId);
    let unavailableRooms = 0;
    let activeRoomCount = 0;
    for (const row of roomSummary) {
      activeRoomCount += Number(row.count ?? 0);
      if (row.status === 'out_of_order' || row.status === 'out_of_service') {
        unavailableRooms += row.count;
      }
    }
    const inventoryRooms = activeRoomCount > 0 ? activeRoomCount : propertyTotal;
    const availableRooms = Math.max(0, inventoryRooms - unavailableRooms);
    const occupancyRate = availableRooms > 0 ? roomsSold / availableRooms : 0;
    // ADR / RevPAR computed via Decimal since they are displayed as currency
    const adrDec = roomsSold > 0 ? roomRevenueDec.div(roomsSold) : new Decimal(0);
    const revparDec = adrDec.times(occupancyRate);
    const adr = adrDec.toNumber();
    const revpar = revparDec.toNumber();

    return {
      roomRevenue,
      taxRevenue,
      totalRevenue,
      roomsSold,
      occupancyRate: Math.round(occupancyRate * 10000) / 10000,
      adr: Math.round(adr * 100) / 100,
      revpar: Math.round(revpar * 100) / 100,
    };
  }

  // --- Audit Run CRUD ---

  async findCompletedAudit(propertyId: string, businessDate: string) {
    const [existing] = await this.db
      .select()
      .from(auditRuns)
      .where(
        and(
          eq(auditRuns.propertyId, propertyId),
          eq(auditRuns.businessDate, businessDate),
          eq(auditRuns.status, 'completed' as any),
        ),
      );
    return existing ?? null;
  }

  async createAuditRun(propertyId: string, businessDate: string) {
    const [auditRun] = await this.db
      .insert(auditRuns)
      .values({
        propertyId,
        businessDate,
        status: 'running',
      })
      .returning();
    return auditRun;
  }

  /**
   * Bug 4: concurrency-safe insert-or-get.
   * Relies on the (property_id, business_date) unique index. If another
   * process already inserted an audit run for this date, onConflictDoNothing
   * returns zero rows; we then SELECT the existing row and tag it _preexisting.
   */
  async createOrGetAuditRun(propertyId: string, businessDate: string) {
    const inserted = await this.db
      .insert(auditRuns)
      .values({
        propertyId,
        businessDate,
        status: 'running',
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      return inserted[0];
    }

    // Conflict — fetch the existing row
    const [existing] = await this.db
      .select()
      .from(auditRuns)
      .where(
        and(
          eq(auditRuns.propertyId, propertyId),
          eq(auditRuns.businessDate, businessDate),
        ),
      );
    if (!existing) {
      // Extremely unlikely: conflict without a visible row. Surface clearly.
      throw new ConflictException(
        `Night audit row conflict for ${businessDate} but no existing row visible`,
      );
    }
    return { ...existing, _preexisting: true };
  }

  async completeAuditRun(
    id: string,
    data: {
      roomChargesPosted: string;
      taxChargesPosted: string;
      noShowsProcessed: string;
      summary: RevenueSummary;
      errors: Array<{ message: string; entity?: string }>;
    },
  ) {
    const [updated] = await this.db
      .update(auditRuns)
      .set({
        status: 'completed',
        roomChargesPosted: data.roomChargesPosted,
        taxChargesPosted: data.taxChargesPosted,
        noShowsProcessed: data.noShowsProcessed,
        summary: data.summary,
        errors: data.errors.length > 0 ? data.errors : null,
        completedAt: new Date(),
      })
      .where(eq(auditRuns.id, id))
      .returning();
    return updated;
  }

  async failAuditRun(id: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await this.db
      .update(auditRuns)
      .set({
        status: 'failed',
        errors: [{ message }],
        completedAt: new Date(),
      })
      .where(eq(auditRuns.id, id));
  }

  async listAuditRuns(propertyId: string) {
    return this.db
      .select()
      .from(auditRuns)
      .where(eq(auditRuns.propertyId, propertyId))
      .orderBy(sql`${auditRuns.businessDate} desc`);
  }

  async getAuditRun(id: string, propertyId: string) {
    const [run] = await this.db
      .select()
      .from(auditRuns)
      .where(
        and(eq(auditRuns.id, id), eq(auditRuns.propertyId, propertyId)),
      );
    if (!run) {
      throw new NotFoundException(`Audit run ${id} not found`);
    }
    return run;
  }

  // --- Utilities ---

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]!;
  }
}
