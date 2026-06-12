import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { roomingListEntries } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { ReservationService } from '../reservation/reservation.service';
import { AllotmentService } from './allotment.service';
import { GroupProfileService } from './group-profile.service';
import { ImportRoomingListDto, RoomingListEntryDto } from './dto/import-rooming-list.dto';

@Injectable()
export class RoomingListService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly reservationService: ReservationService,
    private readonly allotmentService: AllotmentService,
    private readonly groupProfileService: GroupProfileService,
  ) {}

  /**
   * Ingest a rooming list (KB 14.6). Each row becomes a member reservation when
   * it has enough data (existing guest + dates + room type + rate). A bad row
   * is flagged 'error' WITHOUT aborting the batch.
   */
  async importRoomingList(blockId: string, propertyId: string, dto: ImportRoomingListDto) {
    const block = await this.allotmentService.findBlockById(blockId, propertyId);

    let created = 0;
    let errors = 0;
    const results: any[] = [];

    for (const entry of dto.entries) {
      // Insert the entry as pending first so it is always recorded.
      const [row] = await this.db
        .insert(roomingListEntries)
        .values({
          propertyId,
          allotmentBlockId: blockId,
          guestName: entry.guestName,
          arrival: entry.arrival ?? block.startDate,
          departure: entry.departure ?? block.endDate,
          roomTypeId: entry.roomTypeId,
          status: 'pending',
        })
        .returning();

      try {
        const { reservation, stayDate, roomTypeId } = await this.createMemberReservation(
          block,
          propertyId,
          entry,
        );

        await this.db
          .update(roomingListEntries)
          .set({
            reservationId: reservation.id,
            roomTypeId,
            status: 'created',
            updatedAt: new Date(),
          })
          .where(eq(roomingListEntries.id, row.id));

        // Link the new reservation to the group profile and record pickup.
        await this.groupProfileService.linkReservation(
          block.groupProfileId,
          propertyId,
          reservation.id,
        );
        await this.allotmentService.incrementPickup(
          blockId,
          propertyId,
          stayDate,
          roomTypeId,
          null,
        );

        created++;
        results.push({ entryId: row.id, status: 'created', reservationId: reservation.id });
      } catch (err: any) {
        await this.db
          .update(roomingListEntries)
          .set({
            status: 'error',
            errorNote: err?.message ?? 'Failed to create reservation',
            updatedAt: new Date(),
          })
          .where(eq(roomingListEntries.id, row.id));
        errors++;
        results.push({ entryId: row.id, status: 'error', error: err?.message });
      }
    }

    await this.webhookService.emit(
      'group.rooming_list_imported',
      'allotment_block',
      blockId,
      { created, errors, total: dto.entries.length },
      propertyId,
    );

    return { created, errors, total: dto.entries.length, results };
  }

  private async createMemberReservation(
    block: any,
    propertyId: string,
    entry: RoomingListEntryDto,
  ) {
    if (!entry.guestId) {
      throw new Error('guest required');
    }
    const roomTypeId = entry.roomTypeId;
    if (!roomTypeId) {
      throw new Error('room type required');
    }
    const ratePlanId = entry.ratePlanId ?? block.ratePlanId;
    if (!ratePlanId) {
      throw new Error('rate plan required (none on entry or block)');
    }
    const arrivalDate = entry.arrival ?? block.startDate;
    const departureDate = entry.departure ?? block.endDate;
    const currencyCode = entry.currencyCode ?? 'USD';
    const totalAmount = entry.totalAmount ?? '0.00';

    const reservation = await this.reservationService.create({
      propertyId,
      guestId: entry.guestId,
      arrivalDate,
      departureDate,
      roomTypeId,
      ratePlanId,
      totalAmount,
      currencyCode,
      source: 'group',
    });

    return { reservation, stayDate: arrivalDate, roomTypeId };
  }

  async listEntries(blockId: string, propertyId: string) {
    return this.db
      .select()
      .from(roomingListEntries)
      .where(
        and(
          eq(roomingListEntries.allotmentBlockId, blockId),
          eq(roomingListEntries.propertyId, propertyId),
        ),
      )
      .orderBy(roomingListEntries.createdAt);
  }
}
