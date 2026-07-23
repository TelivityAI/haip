import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
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
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import { CreateRatePlanComponentDto } from './dto/create-rate-plan-component.dto';
import { AttachReservationServiceDto } from './dto/attach-reservation-service.dto';

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

  async findServiceById(id: string, propertyId: string) {
    const [row] = await this.db
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

  private async findReservation(reservationId: string, propertyId: string) {
    const [reservation] = await this.db
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

  private async findOpenGuestFolio(reservationId: string, propertyId: string) {
    const [folio] = await this.db
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
  ): Promise<boolean> {
    const conditions: any[] = [
      eq(charges.folioId, folioId),
      eq(charges.propertyId, propertyId),
      eq(charges.isReversal, false),
      like(charges.description, `%${this.svcTag(reservationServiceId)}%`),
    ];
    if (businessDate) {
      conditions.push(sql`${charges.serviceDate}::date = ${businessDate}`);
    }
    const [existing] = await this.db
      .select({ id: charges.id })
      .from(charges)
      .where(and(...conditions))
      .limit(1);
    return !!existing;
  }

  async attachToReservation(reservationId: string, dto: AttachReservationServiceDto) {
    const reservation = await this.findReservation(reservationId, dto.propertyId);
    const service = await this.findServiceById(dto.serviceId, dto.propertyId);

    if (!service.isActive) {
      throw new BadRequestException('Service is not active');
    }

    const quantity = dto.quantity ?? 1;
    const unitPrice = dto.unitPrice ?? service.price;

    const [row] = await this.db
      .insert(reservationServices)
      .values({
        propertyId: dto.propertyId,
        reservationId: reservation.id,
        serviceId: service.id,
        quantity,
        unitPrice,
        currencyCode: service.currencyCode,
        startDate: dto.startDate,
        endDate: dto.endDate,
        status: 'confirmed',
        sourceChannel: dto.sourceChannel ?? 'front_desk',
        postingRule: service.postingRule,
        chargeType: service.chargeType,
        notes: dto.notes,
      })
      .returning();

    await this.webhookService.emit(
      'reservation.service_attached',
      'reservation_service',
      row.id,
      {
        reservationId,
        serviceId: service.id,
        serviceName: service.name,
        quantity,
        unitPrice,
        postingRule: row.postingRule,
      },
      dto.propertyId,
    );

    return row;
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

  async cancelReservationService(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(reservationServices)
      .where(
        and(eq(reservationServices.id, id), eq(reservationServices.propertyId, propertyId)),
      );
    if (!row) {
      throw new NotFoundException(`Reservation service ${id} not found`);
    }
    if (row.status === 'cancelled') {
      throw new BadRequestException('Reservation service is already cancelled');
    }
    if (row.status === 'posted') {
      throw new BadRequestException('Cannot cancel a posted reservation service');
    }

    const [updated] = await this.db
      .update(reservationServices)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(eq(reservationServices.id, id), eq(reservationServices.propertyId, propertyId)),
      )
      .returning();

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
  async ensurePackageComponents(reservationId: string, propertyId: string) {
    const reservation = await this.findReservation(reservationId, propertyId);

    const components = await this.db
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

    const existing = await this.db
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

      const service = await this.findServiceById(component.serviceId, propertyId);
      let unitPrice: string;
      if (component.amountOverride != null) {
        unitPrice = component.amountOverride;
      } else if (component.includedInRate) {
        unitPrice = '0.00';
      } else {
        unitPrice = service.price;
      }

      const [row] = await this.db
        .insert(reservationServices)
        .values({
          propertyId,
          reservationId,
          serviceId: service.id,
          quantity: component.quantity ?? 1,
          unitPrice,
          currencyCode: service.currencyCode,
          status: 'confirmed',
          sourceChannel: 'package',
          postingRule: service.postingRule,
          chargeType: service.chargeType,
        })
        .returning();

      await this.webhookService.emit(
        'reservation.service_attached',
        'reservation_service',
        row.id,
        {
          reservationId,
          serviceId: service.id,
          serviceName: service.name,
          sourceChannel: 'package',
          quantity: row.quantity,
          unitPrice,
        },
        propertyId,
      );

      attached.push(row);
    }

    return attached;
  }

  async postOnceForReservation(reservationId: string, propertyId: string) {
    const reservation = await this.findReservation(reservationId, propertyId);
    const folio = await this.findOpenGuestFolio(reservationId, propertyId);
    if (!folio) {
      throw new BadRequestException(
        `No open guest folio for reservation ${reservationId}`,
      );
    }

    const rows = await this.db
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
      .where(
        and(
          eq(reservationServices.propertyId, propertyId),
          eq(reservationServices.reservationId, reservationId),
          eq(reservationServices.status, 'confirmed' as any),
          inArray(reservationServices.postingRule, ['once', 'included_in_rate'] as any),
        ),
      );

    const posted: any[] = [];
    const serviceDate =
      reservation.arrivalDate ?? new Date().toISOString().slice(0, 10);

    for (const { rs, serviceName } of rows) {
      if (await this.hasPostedCharge(folio.id, propertyId, rs.id)) {
        if (rs.status === 'confirmed') {
          await this.db
            .update(reservationServices)
            .set({ status: 'posted', updatedAt: new Date() })
            .where(
              and(
                eq(reservationServices.id, rs.id),
                eq(reservationServices.propertyId, propertyId),
              ),
            );
        }
        continue;
      }

      const amount = new Decimal(rs.unitPrice).times(rs.quantity).toFixed(2);
      const description = `${serviceName} ${this.svcTag(rs.id)}`;

      // FolioService rejects non-positive amounts except adjustments/reversals.
      // Zero-priced included lines are marked posted without a ledger row.
      if (new Decimal(amount).greaterThan(0)) {
        await this.folioService.postCharge(folio.id, {
          propertyId,
          type: rs.chargeType,
          description,
          amount,
          currencyCode: rs.currencyCode,
          serviceDate: new Date(serviceDate + 'T00:00:00Z').toISOString(),
          guestId: reservation.guestId,
        });
      }

      const [updated] = await this.db
        .update(reservationServices)
        .set({ status: 'posted', updatedAt: new Date() })
        .where(
          and(
            eq(reservationServices.id, rs.id),
            eq(reservationServices.propertyId, propertyId),
          ),
        )
        .returning();

      await this.webhookService.emit(
        'reservation.service_posted',
        'reservation_service',
        rs.id,
        {
          reservationId,
          folioId: folio.id,
          amount,
          postingRule: rs.postingRule,
          chargeType: rs.chargeType,
        },
        propertyId,
      );

      posted.push(updated);
    }

    return { posted, count: posted.length };
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
          eq(reservationServices.status, 'confirmed' as any),
          eq(reservationServices.postingRule, 'per_night' as any),
          inArray(reservations.status, [...IN_HOUSE_STATUSES] as any),
        ),
      );

    const posted: any[] = [];
    const skipped: string[] = [];
    const errors: { id: string; message: string }[] = [];

    for (const { rs, serviceName, reservation } of rows) {
      try {
        if (rs.startDate && date < rs.startDate) {
          skipped.push(rs.id);
          continue;
        }
        if (rs.endDate && date > rs.endDate) {
          skipped.push(rs.id);
          continue;
        }

        const folio = await this.findOpenGuestFolio(reservation.id, propertyId);
        if (!folio) {
          errors.push({
            id: rs.id,
            message: `No open guest folio for reservation ${reservation.id}`,
          });
          continue;
        }

        if (await this.hasPostedCharge(folio.id, propertyId, rs.id, date)) {
          skipped.push(rs.id);
          continue;
        }

        const amount = new Decimal(rs.unitPrice).times(rs.quantity).toFixed(2);
        if (new Decimal(amount).lessThanOrEqualTo(0)) {
          skipped.push(rs.id);
          continue;
        }

        const description = `${serviceName} ${this.svcTag(rs.id)}`;
        const charge = await this.folioService.postCharge(folio.id, {
          propertyId,
          type: rs.chargeType,
          description,
          amount,
          currencyCode: rs.currencyCode,
          serviceDate: new Date(date + 'T00:00:00Z').toISOString(),
          guestId: reservation.guestId,
        });

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
            postingRule: 'per_night',
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
}
