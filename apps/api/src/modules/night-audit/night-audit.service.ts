import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, sql, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  auditRuns,
  reservations,
  folios,
  charges,
  ratePlans,
  properties,
  rooms,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { ReservationService } from '../reservation/reservation.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { RoomStatusService } from '../room/room-status.service';
import { WebhookService } from '../webhook/webhook.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { RunAuditDto } from './dto/run-audit.dto';
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
      // 4. Post room tariffs to all in-house folios
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

      // 9. Lock charges for the business date
      await this.lockChargesForDate(dto.propertyId, dto.businessDate);

      // 10. Generate revenue summary
      const summary = await this.generateRevenueSummary(dto.propertyId, dto.businessDate);

      // 11. Complete audit run
      const completed = await this.completeAuditRun(auditRun.id, {
        roomChargesPosted: tariffResult.totalRoom,
        taxChargesPosted: tariffResult.totalTax,
        noShowsProcessed: String(noShowResult.count),
        summary,
        errors: [
          ...tariffResult.errors,
          ...noShowResult.errors,
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
        ),
      );

    // Monetary totals via Decimal to preserve precision
    let totalRoom = new Decimal(0);
    let totalTax = new Decimal(0);
    let count = 0;
    const errors: Array<{ message: string; entity?: string }> = [];

    for (const reservation of inHouseReservations) {
      try {
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

        // Idempotency: check if room charge already posted for this date
        const serviceDateStart = new Date(businessDate + 'T00:00:00Z');
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

        if (existingCharge) {
          continue; // Already posted, skip
        }

        // Get nightly rate from rate plan or fallback
        let rate: string;
        const [ratePlan] = await this.db
          .select({ baseAmount: ratePlans.baseAmount })
          .from(ratePlans)
          .where(eq(ratePlans.id, reservation.ratePlanId));

        if (ratePlan) {
          rate = ratePlan.baseAmount;
        } else {
          // Fallback: total / nights
          rate = new Decimal(reservation.totalAmount).div(reservation.nights).toFixed(2);
        }

        // Post room tariff — TaxService auto-posts tax charges via FolioService
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
    const noShowFeeAmount = (property?.settings as any)?.noShowFeeAmount;

    let count = 0;
    const reservationIds: string[] = [];
    const errors: Array<{ message: string; entity?: string }> = [];

    for (const reservation of noShowCandidates) {
      try {
        // Mark as no-show
        await this.reservationService.markNoShow(reservation.id, propertyId);
        reservationIds.push(reservation.id);
        count++;

        // Post no-show fee if configured
        if (noShowFeeAmount && noShowFeeAmount > 0) {
          try {
            // Find or create folio
            let [folio] = await this.db
              .select()
              .from(folios)
              .where(
                and(
                  eq(folios.reservationId, reservation.id),
                  eq(folios.propertyId, propertyId),
                  eq(folios.type, 'guest' as any),
                ),
              );

            if (!folio) {
              folio = await this.folioService.createAutoFolio(reservation);
            }

            await this.folioService.postCharge(folio.id, {
              propertyId,
              type: 'fee',
              description: 'No-show fee',
              amount: String(noShowFeeAmount),
              currencyCode: reservation.currencyCode,
              serviceDate: new Date(businessDate + 'T00:00:00Z').toISOString(),
            });
          } catch (feeErr: any) {
            errors.push({
              message: `No-show fee failed for ${reservation.id}: ${feeErr.message}`,
              entity: reservation.id,
            });
          }
        }

        // Free assigned room if any
        if (reservation.roomId) {
          try {
            await this.db
              .update(reservations)
              .set({ roomId: null, updatedAt: new Date() })
              .where(eq(reservations.id, reservation.id));
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
        ),
      );
    const roomsSold = roomsSoldResult?.count ?? 0;

    // Total available rooms
    const [propertyData] = await this.db
      .select({ totalRooms: properties.totalRooms })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const totalRooms = propertyData?.totalRooms ?? 0;

    // OOO/OOS rooms
    const roomSummary = await this.roomStatusService.getPropertyRoomSummary(propertyId);
    let unavailableRooms = 0;
    for (const row of roomSummary) {
      if (row.status === 'out_of_order' || row.status === 'out_of_service') {
        unavailableRooms += row.count;
      }
    }

    const availableRooms = totalRooms - unavailableRooms;
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
