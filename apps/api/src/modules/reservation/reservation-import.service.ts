import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { bookings, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ReservationService } from './reservation.service';
import { ImportReservationsDto, CreateReservationRow } from './dto/import-reservations.dto';
import { MigrationLegacyIdMapService } from '../migration/migration-legacy-id-map.service';

/**
 * Batch reservation import (Tier 4 — Reservation Operations Polish).
 *
 * Onboarding/migration helper. Accepts a pre-parsed JSON array of rows. Each row
 * is created via ReservationService.create in a try/catch; a single failing row
 * never aborts the batch. Supports legacy id resolution, dry-run, and idempotent
 * dedupe via migration_legacy_id_map (project + entity + legacy_id) and the
 * externalConfirmation + channelCode precedent from channel inbound.
 */
@Injectable()
export class ReservationImportService {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly legacyIdMap: MigrationLegacyIdMapService,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  async importReservations(propertyId: string, dto: ImportReservationsDto) {
    const results: Array<{
      index: number;
      success: boolean;
      skipped?: boolean;
      reservationId?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i]!;
      try {
        const outcome = await this.importOneRow(propertyId, dto, row);
        results.push({ index: i, ...outcome });
      } catch (err: any) {
        results.push({
          index: i,
          success: false,
          error: err.message ?? 'Unknown error',
        });
      }
    }

    return {
      results,
      created: results.filter((r) => r.success && !r.skipped).length,
      failed: results.filter((r) => !r.success).length,
      skipped: results.filter((r) => r.skipped).length,
    };
  }

  private async importOneRow(
    propertyId: string,
    dto: ImportReservationsDto,
    row: CreateReservationRow,
  ) {
    if (dto.projectId && row.legacyId) {
      const existingId = await this.legacyIdMap.lookup(
        propertyId,
        dto.projectId,
        'reservations',
        row.legacyId,
      );
      if (existingId) {
        return { success: true, skipped: true, reservationId: existingId };
      }
    }

    if (row.externalConfirmation && row.channelCode) {
      const existingBooking = await this.findByExternalConfirmation(
        row.externalConfirmation,
        row.channelCode,
        propertyId,
      );
      if (existingBooking) {
        const [existingReservation] = await this.db
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.bookingId, existingBooking.id),
              eq(reservations.propertyId, propertyId),
            ),
          );
        if (existingReservation) {
          if (dto.projectId && row.legacyId && !dto.dryRun) {
            await this.legacyIdMap.record(
              propertyId,
              dto.projectId,
              'reservations',
              row.legacyId,
              existingReservation.id,
            );
          }
          return { success: true, skipped: true, reservationId: existingReservation.id };
        }
      }
    }

    const resolved = await this.resolveRow(propertyId, dto.projectId, row);

    if (dto.dryRun) {
      return { success: true };
    }

    const reservation = await this.reservationService.create({
      ...resolved,
      propertyId,
    } as any);

    if (dto.projectId && row.legacyId) {
      await this.legacyIdMap.record(
        propertyId,
        dto.projectId,
        'reservations',
        row.legacyId,
        reservation.id,
      );
    }

    return { success: true, reservationId: reservation.id };
  }

  private async resolveRow(
    propertyId: string,
    projectId: string | undefined,
    row: CreateReservationRow,
  ) {
    const guestId = await this.resolveRef(
      propertyId,
      projectId,
      'guests',
      row.guestId,
      row.legacyGuestId,
      'guest',
      'legacyGuestId',
    );
    const roomTypeId = await this.resolveRef(
      propertyId,
      projectId,
      'room-types',
      row.roomTypeId,
      row.legacyRoomTypeId,
      'room type',
      'legacyRoomTypeId',
    );
    const ratePlanId = await this.resolveRef(
      propertyId,
      projectId,
      'rate-plans',
      row.ratePlanId,
      row.legacyRatePlanId,
      'rate plan',
      'legacyRatePlanId',
    );

    return {
      guestId,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      roomTypeId,
      ratePlanId,
      totalAmount: row.totalAmount,
      currencyCode: row.currencyCode,
      source: row.source,
      adults: row.adults,
      children: row.children,
      specialRequests: row.specialRequests,
      channelCode: row.channelCode,
      externalConfirmation: row.externalConfirmation,
    };
  }

  private async resolveRef(
    propertyId: string,
    projectId: string | undefined,
    entity: string,
    haipId: string | undefined,
    legacyId: string | undefined,
    label: string,
    legacyField: string,
  ): Promise<string> {
    if (haipId) return haipId;
    if (legacyId && projectId) {
      const mapped = await this.legacyIdMap.lookup(propertyId, projectId, entity, legacyId);
      if (mapped) return mapped;
      throw new BadRequestException(
        `No HAIP id mapped for ${label} legacy id "${legacyId}" in project ${projectId}`,
      );
    }
    throw new BadRequestException(`Either ${label} id or ${legacyField} is required`);
  }

  private async findByExternalConfirmation(
    externalConfirmation: string,
    channelCode: string,
    propertyId: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          eq(bookings.externalConfirmation, externalConfirmation),
          eq(bookings.channelCode, channelCode),
        ),
      );
    return existing ?? null;
  }
}
