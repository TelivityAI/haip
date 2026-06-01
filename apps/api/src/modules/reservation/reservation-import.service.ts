import { Injectable } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ImportReservationsDto } from './dto/import-reservations.dto';

/**
 * Batch reservation import (Tier 4 — Reservation Operations Polish).
 *
 * Onboarding/migration helper. Accepts a pre-parsed JSON array of rows (actual
 * CSV-file parsing / multipart upload is out of scope — a thin CSV parser can map
 * columns to ImportReservationsDto.rows and POST the result). Each row is created
 * via ReservationService.create in a try/catch; a single failing row never aborts
 * the batch. create() already emits reservation.created per row.
 */
@Injectable()
export class ReservationImportService {
  constructor(private readonly reservationService: ReservationService) {}

  async importReservations(propertyId: string, dto: ImportReservationsDto) {
    const results: Array<{
      index: number;
      success: boolean;
      reservationId?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i]!;
      try {
        const reservation = await this.reservationService.create({
          ...row,
          propertyId,
        } as any);
        results.push({ index: i, success: true, reservationId: reservation.id });
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
      created: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }
}
