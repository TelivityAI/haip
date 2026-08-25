import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, sql, inArray, like } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  services,
  ratePlanComponents,
  reservationServices,
  reservations,
  folios,
  charges,
  ratePlans,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { withAcceptedPricingLock } from '../../common/database/accepted-pricing-lock';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import { CreateRatePlanComponentDto } from './dto/create-rate-plan-component.dto';
import { AttachReservationServiceDto } from './dto/attach-reservation-service.dto';
import { reservationServiceAttachedPayload } from './reservation-service-event';

export interface ReservationServicePricingOverride {
  currencyCode: string;
  postingRule: string;
  chargeType: string;
}

const IN_HOUSE_STATUSES = ['checked_in', 'stayover', 'due_out'] as const;

@Injectable()
export class AncillaryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly folioService: FolioService,
    private readonly webhookService: WebhookService,
  ) {}

  // --- Catalog services ---

  async createService(dto: CreateServiceDto) {
    const [row] = await this.db
      .insert(services)
      .values({
        propertyId: dto.propertyId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        chargeType: dto.chargeType,
        price: dto.price,
        currencyCode: dto.currencyCode,
        taxCode: dto.taxCode,
        postingRule: dto.postingRule,
        sellChannels: dto.sellChannels ?? [],
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();

    await this.webhookService.emit(
      'service.created',
      'service',
      row.id,
      { code: row.code, name: row.name, chargeType: row.chargeType },
      row.propertyId,
    );

    return row;
  }

  async findServiceById(id: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, id), eq(services.propertyId, propertyId)));
    if (!row) {
      throw new NotFoundException(`Service ${id} not found`);
    }
    return row;
  }

  async listServices(dto: ListServicesDto) {
    const conditions: any[] = [eq(services.propertyId, dto.propertyId)];
    if (dto.isActive !== undefined) {
      conditions.push(eq(services.isActive, dto.isActive === 'true'));
    }
    if (dto.channel) {
      conditions.push(sql`${services.sellChannels}::jsonb ? ${dto.channel}`);
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(services)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(services.sortOrder, services.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(services)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async updateService(id: string, propertyId: string, dto: UpdateServiceDto) {
    await this.findServiceById(id, propertyId);
    const [updated] = await this.db
      .update(services)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.propertyId, propertyId)))
      .returning();

    await this.webhookService.emit(
      'service.updated',
      'service',
      updated.id,
      { code: updated.code, name: updated.name },
      updated.propertyId,
    );

    return updated;
  }

  // --- Rate plan components ---

  async createRatePlanComponent(dto: CreateRatePlanComponentDto) {
    const [ratePlan] = await this.db
      .select()
      .from(ratePlans)
      .where(
        and(eq(ratePlans.id, dto.ratePlanId), eq(ratePlans.propertyId, dto.propertyId)),
      );
    if (!ratePlan) {
      throw new NotFoundException(`Rate plan ${dto.ratePlanId} not found`);
    }

    await this.findServiceById(dto.serviceId, dto.propertyId);

    const [row] = await this.db
      .insert(ratePlanComponents)
      .values({
        propertyId: dto.propertyId,
        ratePlanId: dto.ratePlanId,
        serviceId: dto.serviceId,
        quantity: dto.quantity ?? 1,
        amountOverride: dto.amountOverride,
        includedInRate: dto.includedInRate ?? true,
      })
      .returning();

    return row;
  }

  async listRatePlanComponents(propertyId: string, ratePlanId: string) {
    return this.db
      .select()
      .from(ratePlanComponents)
      .where(
        and(
          eq(ratePlanComponents.propertyId, propertyId),
          eq(ratePlanComponents.ratePlanId, ratePlanId),
        ),
      )
      .orderBy(ratePlanComponents.createdAt);
  }

  async deleteRatePlanComponent(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(ratePlanComponents)
      .where(
        and(eq(ratePlanComponents.id, id), eq(ratePlanComponents.propertyId, propertyId)),
      );
    if (!row) {
      throw new NotFoundException(`Rate plan component ${id} not found`);
    }

    await this.db
      .delete(ratePlanComponents)
      .where(
        and(eq(ratePlanComponents.id, id), eq(ratePlanComponents.propertyId, propertyId)),
      );

    return { deleted: true, id };
  }

  // --- Reservation services ---

  private async findReservation(reservationId: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [reservation] = await db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)),
      );
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }
    return reservation;
  }

  private async findOpenGuestFolio(reservationId: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [folio] = await db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.reservationId, reservationId),
          eq(folios.propertyId, propertyId),
          eq(folios.type, 'guest' as any),
          eq(folios.status, 'open' as any),
        ),
      );
    return folio ?? null;
  }

  private svcTag(reservationServiceId: string): string {
    return `[svc:${reservationServiceId}]`;
  }

  private async hasPostedCharge(
    folioId: string,
    propertyId: string,
    reservationServiceId: string,
    businessDate?: string,
    tx?: any,
  ): Promise<boolean> {
    const db = tx ?? this.db;
    const conditions: any[] = [
      eq(charges.folioId, folioId),
      eq(charges.propertyId, propertyId),
      eq(charges.isReversal, false),
      like(charges.description, `%${this.svcTag(reservationServiceId)}%`),
    ];
    if (businessDate) {
      conditions.push(sql`${charges.serviceDate}::date = ${businessDate}`);
    }
    const [existing] = await db
      .select({ id: charges.id })
      .from(charges)
      .where(and(...conditions))
      .limit(1);
    return !!existing;
  }

  async attachToReservation(
    reservationId: string,
    dto: AttachReservationServiceDto,
    tx?: any,
    pricingOverride?: ReservationServicePricingOverride,
  ) {
    const db = tx ?? this.db;
    const reservation = await this.findReservation(reservationId, dto.propertyId, db);
    const service = await this.findServiceById(dto.serviceId, dto.propertyId, db);

    if (!service.isActive) {
      throw new BadRequestException('Service is not active');
    }

    const quantity = dto.quantity ?? 1;
    const unitPrice = dto.unitPrice ?? service.price;

    const [row] = await db
      .insert(reservationServices)
      .values({
        propertyId: dto.propertyId,
        reservationId: reservation.id,
        serviceId: service.id,
        quantity,
        unitPrice,
        currencyCode: pricingOverride?.currencyCode ?? service.currencyCode,
        startDate: dto.startDate,
        endDate: dto.endDate,
        status: 'confirmed',
        sourceChannel: dto.sourceChannel ?? 'front_desk',
        postingRule: pricingOverride?.postingRule ?? service.postingRule,
        chargeType: pricingOverride?.chargeType ?? service.chargeType,
        notes: dto.notes,
      })
      .returning();

    if (!tx) {
      await this.webhookService.emit(
        'reservation.service_attached',
        'reservation_service',
        row.id,
        reservationServiceAttachedPayload(row, service.name),
        dto.propertyId,
      );
    }

    return { ...row, serviceName: service.name };
  }

  async listForReservation(propertyId: string, reservationId: string) {
    await this.findReservation(reservationId, propertyId);
    return this.db
      .select()
      .from(reservationServices)
      .where(
        and(
          eq(reservationServices.propertyId, propertyId),
          eq(reservationServices.reservationId, reservationId),
        ),
      )
      .orderBy(reservationServices.createdAt);
  }

  async cancelReservationService(id: string, propertyId: string, reservationId: string) {
    const updated = await withAcceptedPricingLock(
      this.db,
      propertyId,
      reservationId,
      async (tx) => {
        const query = tx
          .select()
          .from(reservationServices)
          .where(and(
            eq(reservationServices.id, id),
            eq(reservationServices.propertyId, propertyId),
            eq(reservationServices.reservationId, reservationId),
          ));
        const [row] = typeof query.for === 'function'
          ? await query.for('update')
          : await query;
        if (!row) {
          throw new NotFoundException(`Reservation service ${id} not found`);
        }
        if (row.status === 'cancelled') {
          throw new BadRequestException('Reservation service is already cancelled');
        }
        if (row.status === 'posted') {
          throw new BadRequestException('Cannot cancel a posted reservation service');
        }

        const [cancelled] = await tx
          .update(reservationServices)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(and(
            eq(reservationServices.id, id),
            eq(reservationServices.propertyId, propertyId),
            eq(reservationServices.reservationId, reservationId),
            inArray(reservationServices.status, ['quoted', 'confirmed'] as any),
          ))
          .returning();
        if (!cancelled) {
          throw new ConflictException(
            `Reservation service ${id} changed while it was being cancelled`,
          );
        }
        return cancelled;
      },
    );

    await this.webhookService.emit(
      'reservation.service_cancelled',
      'reservation_service',
      updated.id,
      { reservationId: updated.reservationId, serviceId: updated.serviceId },
      propertyId,
    );

    return updated;
  }

  /**
   * Attach package rate-plan components that are not yet on the reservation.
   * Intended to be called from check-in / book flows.
   */
  async ensurePackageComponents(
    reservationId: string,
    propertyId: string,
    tx?: any,
    acceptedPricing?: {
      freezeUnquotedAtZero: true;
      currencyCode: string;
    },
  ) {
    const db = tx ?? this.db;
    const reservation = await this.findReservation(reservationId, propertyId, db);

    const components = await db
      .select()
      .from(ratePlanComponents)
      .where(
        and(
          eq(ratePlanComponents.propertyId, propertyId),
          eq(ratePlanComponents.ratePlanId, reservation.ratePlanId),
        ),
      );

    if (components.length === 0) {
      return [];
    }

    const existing = await db
      .select({ serviceId: reservationServices.serviceId })
      .from(reservationServices)
      .where(
        and(
          eq(reservationServices.propertyId, propertyId),
          eq(reservationServices.reservationId, reservationId),
        ),
      );
    const existingServiceIds = new Set(existing.map((e: { serviceId: string }) => e.serviceId));

    const attached: any[] = [];
    for (const component of components) {
      if (existingServiceIds.has(component.serviceId)) {
        continue;
      }

      const service = await this.findServiceById(component.serviceId, propertyId, db);
      let unitPrice: string;
      if (acceptedPricing?.freezeUnquotedAtZero) {
        // Booking-request totals contain only explicitly quoted extras. A rate
        // package component absent from that immutable quote may still be
        // attached for operations/event parity, but can never acquire a later
        // live catalog price and silently exceed the staff-accepted total.
        unitPrice = '0.00';
      } else if (component.amountOverride != null) {
        unitPrice = component.amountOverride;
      } else if (component.includedInRate) {
        unitPrice = '0.00';
      } else {
        unitPrice = service.price;
      }

      const [row] = await db
        .insert(reservationServices)
        .values({
          propertyId,
          reservationId,
          serviceId: service.id,
          quantity: component.quantity ?? 1,
          unitPrice,
          currencyCode: acceptedPricing?.currencyCode ?? service.currencyCode,
          status: 'confirmed',
          sourceChannel: 'package',
          postingRule: service.postingRule,
          chargeType: service.chargeType,
        })
        .returning();

      if (!tx) {
        await this.webhookService.emit(
          'reservation.service_attached',
          'reservation_service',
          row.id,
          reservationServiceAttachedPayload(row, service.name),
          propertyId,
        );
      }

      attached.push({ ...row, serviceName: service.name });
    }

    return attached;
  }

  async postOnceForReservation(reservationId: string, propertyId: string) {
    const result = await withAcceptedPricingLock(
      this.db,
      propertyId,
      reservationId,
      async (tx) => {
        const reservation = await this.findReservation(reservationId, propertyId, tx);
        const folio = await this.findOpenGuestFolio(reservationId, propertyId, tx);
        if (!folio) {
          throw new BadRequestException(
            `No open guest folio for reservation ${reservationId}`,
          );
        }
        const rows = await tx
          .select({
            rs: reservationServices,
            serviceName: services.name,
          })
          .from(reservationServices)
          .innerJoin(
            services,
            and(
              eq(services.id, reservationServices.serviceId),
              eq(services.propertyId, reservationServices.propertyId),
            ),
          )
          .where(and(
            eq(reservationServices.propertyId, propertyId),
            eq(reservationServices.reservationId, reservationId),
          ));
        const posted: any[] = [];
        const events: Array<{
          reservationServiceId: string;
          amount: string;
          postingRule: string;
          chargeType: string;
        }> = [];
        const folioOutcomes: Array<{ charge: any; wasCreated: boolean }> = [];
        const serviceDate = reservation.arrivalDate ?? new Date().toISOString().slice(0, 10);

        for (const { rs, serviceName } of rows) {
          if (rs.status === 'cancelled') continue;
          const acceptedLine = this.acceptedServiceLine(
            reservation,
            rs.serviceId,
            serviceDate,
            true,
          );
          const hasAcceptedPricing = reservation.acceptedPricingSnapshot != null;
          const effectivePostingRule = acceptedLine?.postingRule ?? rs.postingRule;
          const effectiveChargeType = acceptedLine?.chargeType ?? rs.chargeType;
          if (hasAcceptedPricing) {
            if (!acceptedLine) continue;
            if (!['once', 'included_in_rate'].includes(effectivePostingRule)) continue;
          } else if (
            rs.status !== 'confirmed'
            || !['once', 'included_in_rate'].includes(effectivePostingRule)
          ) {
            continue;
          }
          if (!hasAcceptedPricing && await this.hasPostedCharge(
            folio.id,
            propertyId,
            rs.id,
            undefined,
            tx,
          )) {
            await tx
              .update(reservationServices)
              .set({ status: 'posted', updatedAt: new Date() })
              .where(and(
                eq(reservationServices.id, rs.id),
                eq(reservationServices.propertyId, propertyId),
                eq(reservationServices.status, 'confirmed' as any),
              ));
            continue;
          }

          const amount = acceptedLine?.amount
            ?? new Decimal(rs.unitPrice).times(rs.quantity).toFixed(2);
          let ledgerGroupWasCreated = false;
          if (new Decimal(amount).greaterThan(0)) {
            const chargeInput = {
              propertyId,
              type: effectiveChargeType,
              description: `${serviceName} ${this.svcTag(rs.id)}`,
              amount,
              currencyCode: acceptedLine?.currencyCode ?? rs.currencyCode,
              serviceDate: new Date(
                `${acceptedLine?.date ?? serviceDate}T00:00:00Z`,
              ).toISOString(),
              guestId: reservation.guestId,
            };
            const outcome = acceptedLine
              ? await this.folioService.postChargeFromSnapshotWithOutcome(
                  folio.id,
                  chargeInput,
                  acceptedLine.taxAmount,
                  undefined,
                  `accepted-pricing:reservation-service:${rs.id}:once:${acceptedLine.date}`,
                  tx,
                )
              : {
                  charge: await this.folioService.postCharge(folio.id, chargeInput, tx),
                  wasCreated: true,
                };
            folioOutcomes.push(outcome);
            ledgerGroupWasCreated = outcome.wasCreated;
          }

          let updated: any;
          if (hasAcceptedPricing && rs.status === 'posted') {
            // A once service can acquire a new immutable operational date after
            // a stay amendment. Its row remains posted, while the date-bearing
            // source key decides whether this revision still needs a group.
            if (!ledgerGroupWasCreated) continue;
            updated = rs;
          } else {
            [updated] = await tx
              .update(reservationServices)
              .set({ status: 'posted', updatedAt: new Date() })
              .where(and(
                eq(reservationServices.id, rs.id),
                eq(reservationServices.propertyId, propertyId),
                eq(reservationServices.status, 'confirmed' as any),
              ))
              .returning();
            if (!updated) {
              throw new ConflictException(
                `Reservation service ${rs.id} changed while posting its accepted price`,
              );
            }
          }
          posted.push(updated);
          events.push({
            reservationServiceId: rs.id,
            amount,
            postingRule: effectivePostingRule,
            chargeType: effectiveChargeType,
          });
        }
        return { folio, posted, events, folioOutcomes };
      },
    );

    for (const outcome of result.folioOutcomes) {
      await this.folioService.emitSnapshotChargeWebhooks(
        result.folio.id,
        propertyId,
        outcome,
      );
    }
    for (const event of result.events) {
      await this.webhookService.emit(
        'reservation.service_posted',
        'reservation_service',
        event.reservationServiceId,
        {
          reservationId,
          folioId: result.folio.id,
          amount: event.amount,
          postingRule: event.postingRule,
          chargeType: event.chargeType,
        },
        propertyId,
      );
    }
    return { posted: result.posted, count: result.posted.length };
  }

  async postPerNightForProperty(propertyId: string, businessDate?: string) {
    const date =
      businessDate ?? new Date().toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        rs: reservationServices,
        serviceName: services.name,
        reservation: reservations,
      })
      .from(reservationServices)
      .innerJoin(
        reservations,
        and(
          eq(reservations.id, reservationServices.reservationId),
          eq(reservations.propertyId, reservationServices.propertyId),
        ),
      )
      .innerJoin(
        services,
        and(
          eq(services.id, reservationServices.serviceId),
          eq(services.propertyId, reservationServices.propertyId),
        ),
      )
      .where(
        and(
          eq(reservationServices.propertyId, propertyId),
          inArray(reservations.status, [...IN_HOUSE_STATUSES] as any),
        ),
      );

    const posted: any[] = [];
    const skipped: string[] = [];
    const errors: { id: string; message: string }[] = [];

    for (const { rs, serviceName, reservation } of rows) {
      try {
        if (reservation.acceptedPricingSnapshot) {
          const lockedPost = await withAcceptedPricingLock(
            this.db,
            propertyId,
            reservation.id,
            async (tx) => {
              const [current] = await tx
                .select({
                  rs: reservationServices,
                  serviceName: services.name,
                  reservation: reservations,
                })
                .from(reservationServices)
                .innerJoin(
                  reservations,
                  and(
                    eq(reservations.id, reservationServices.reservationId),
                    eq(reservations.propertyId, reservationServices.propertyId),
                  ),
                )
                .innerJoin(
                  services,
                  and(
                    eq(services.id, reservationServices.serviceId),
                    eq(services.propertyId, reservationServices.propertyId),
                  ),
                )
                .where(and(
                  eq(reservationServices.id, rs.id),
                  eq(reservationServices.propertyId, propertyId),
                  eq(reservationServices.reservationId, reservation.id),
                ));
              if (!current || current.rs.status === 'cancelled') return null;
              const acceptedLine = this.acceptedServiceLine(
                current.reservation,
                current.rs.serviceId,
                date,
                false,
              );
              if (!acceptedLine || acceptedLine.postingRule !== 'per_night') return null;
              const folio = await this.findOpenGuestFolio(reservation.id, propertyId, tx);
              if (!folio) {
                throw new BadRequestException(
                  `No open guest folio for reservation ${reservation.id}`,
                );
              }
              if (new Decimal(acceptedLine.amount).lessThanOrEqualTo(0)) return null;
              const outcome = await this.folioService.postChargeFromSnapshotWithOutcome(
                folio.id,
                {
                  propertyId,
                  type: acceptedLine.chargeType,
                  description: `${current.serviceName} ${this.svcTag(current.rs.id)}`,
                  amount: acceptedLine.amount,
                  currencyCode: acceptedLine.currencyCode,
                  serviceDate: new Date(`${date}T00:00:00Z`).toISOString(),
                  guestId: current.reservation.guestId,
                },
                acceptedLine.taxAmount,
                undefined,
                `accepted-pricing:reservation-service:${current.rs.id}:night:${date}`,
                tx,
              );
              return {
                folio,
                reservation: current.reservation,
                rs: current.rs,
                acceptedLine,
                outcome,
              };
            },
          );
          if (!lockedPost || !lockedPost.outcome.wasCreated) {
            skipped.push(rs.id);
            continue;
          }
          await this.folioService.emitSnapshotChargeWebhooks(
            lockedPost.folio.id,
            propertyId,
            lockedPost.outcome,
          );
          await this.webhookService.emit(
            'reservation.service_posted',
            'reservation_service',
            lockedPost.rs.id,
            {
              reservationId: lockedPost.reservation.id,
              folioId: lockedPost.folio.id,
              amount: lockedPost.acceptedLine.amount,
              businessDate: date,
              postingRule: lockedPost.acceptedLine.postingRule,
              chargeType: lockedPost.acceptedLine.chargeType,
              chargeId: lockedPost.outcome.charge.id,
            },
            propertyId,
          );
          posted.push({
            reservationServiceId: lockedPost.rs.id,
            chargeId: lockedPost.outcome.charge.id,
            amount: lockedPost.acceptedLine.amount,
          });
          continue;
        }

        const acceptedLine = this.acceptedServiceLine(
          reservation,
          rs.serviceId,
          date,
          false,
        );
        const hasAcceptedPricing = reservation.acceptedPricingSnapshot != null;
        const effectivePostingRule = acceptedLine?.postingRule ?? rs.postingRule;
        const effectiveChargeType = acceptedLine?.chargeType ?? rs.chargeType;
        if (hasAcceptedPricing) {
          if (!acceptedLine || effectivePostingRule !== 'per_night') {
            skipped.push(rs.id);
            continue;
          }
        } else if (rs.status !== 'confirmed' || effectivePostingRule !== 'per_night') {
          skipped.push(rs.id);
          continue;
        }
        if (!hasAcceptedPricing) {
          if (rs.startDate && date < rs.startDate) {
            skipped.push(rs.id);
            continue;
          }
          if (rs.endDate && date > rs.endDate) {
            skipped.push(rs.id);
            continue;
          }
        }

        const folio = await this.findOpenGuestFolio(reservation.id, propertyId);
        if (!folio) {
          errors.push({
            id: rs.id,
            message: `No open guest folio for reservation ${reservation.id}`,
          });
          continue;
        }

        if (!hasAcceptedPricing && await this.hasPostedCharge(folio.id, propertyId, rs.id, date)) {
          skipped.push(rs.id);
          continue;
        }
        const amount = acceptedLine?.amount
          ?? new Decimal(rs.unitPrice).times(rs.quantity).toFixed(2);
        if (new Decimal(amount).lessThanOrEqualTo(0)) {
          skipped.push(rs.id);
          continue;
        }

        const description = `${serviceName} ${this.svcTag(rs.id)}`;
        const chargeInput = {
          propertyId,
          type: effectiveChargeType,
          description,
          amount,
          currencyCode: acceptedLine?.currencyCode ?? rs.currencyCode,
          serviceDate: new Date(date + 'T00:00:00Z').toISOString(),
          guestId: reservation.guestId,
        };
        const outcome = acceptedLine
          ? await this.folioService.postChargeFromSnapshotWithOutcome(
              folio.id,
              chargeInput,
              acceptedLine.taxAmount,
              undefined,
              `accepted-pricing:reservation-service:${rs.id}:night:${date}`,
            )
          : {
              charge: await this.folioService.postCharge(folio.id, chargeInput),
              wasCreated: true,
            };
        if (!outcome.wasCreated) {
          skipped.push(rs.id);
          continue;
        }
        const charge = outcome.charge;

        // Stay confirmed until stay ends — idempotency via charge existence.
        await this.webhookService.emit(
          'reservation.service_posted',
          'reservation_service',
          rs.id,
          {
            reservationId: reservation.id,
            folioId: folio.id,
            amount,
            businessDate: date,
            postingRule: effectivePostingRule,
            chargeType: effectiveChargeType,
            chargeId: charge.id,
          },
          propertyId,
        );

        posted.push({ reservationServiceId: rs.id, chargeId: charge.id, amount });
      } catch (err: any) {
        errors.push({ id: rs.id, message: err?.message ?? String(err) });
      }
    }

    return {
      businessDate: date,
      posted,
      skipped,
      errors,
      count: posted.length,
    };
  }

  private acceptedServiceLine(
    reservation: any,
    serviceId: string,
    date: string,
    useFirstLine: boolean,
  ): {
    date: string;
    amount: string;
    taxAmount: string;
    currencyCode: string;
    postingRule: string;
    chargeType: string;
  } | null {
    const pricing = reservation.acceptedPricingSnapshot;
    if (!pricing || !Array.isArray(pricing.services)) return null;
    const service = pricing.services.find(
      (candidate: { serviceId?: string }) => candidate.serviceId === serviceId,
    );
    if (!service || !Array.isArray(service.lineItems)) return null;
    const line = service.lineItems.find(
      (candidate: { date?: string }) => candidate.date === date,
    ) ?? (useFirstLine ? service.lineItems[0] : undefined);
    if (!line) return null;
    return {
      date: line.date,
      amount: line.amount,
      taxAmount: line.taxAmount,
      currencyCode: pricing.currencyCode,
      postingRule: service.postingRule,
      chargeType: service.chargeType,
    };
  }
}
