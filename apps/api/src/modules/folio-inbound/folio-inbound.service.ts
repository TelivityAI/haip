import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  charges,
  folioInboundPosts,
  folios,
  reservations,
  rooms,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { PostFolioInboundChargeDto } from './dto/post-folio-inbound-charge.dto';

const IN_HOUSE_STATUSES = ['checked_in', 'stayover', 'due_out'] as const;

@Injectable()
export class FolioInboundService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly folioService: FolioService,
  ) {}

  async postCharge(propertyId: string, dto: PostFolioInboundChargeDto) {
    return this.db.transaction(async (tx: any) => {
      try {
        await tx
          .insert(folioInboundPosts)
          .values({
            propertyId,
            vendorTxnId: dto.vendorTxnId,
            roomNumber: dto.roomNumber,
            chargeType: dto.type,
            amount: dto.amount,
            currencyCode: dto.currencyCode,
          })
          .returning();
      } catch (error: any) {
        if (this.isDuplicateVendorTxn(error)) {
          return this.returnExistingCharge(tx, propertyId, dto.vendorTxnId);
        }
        throw error;
      }

      const [room] = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.propertyId, propertyId), eq(rooms.number, dto.roomNumber)));
      if (!room) {
        throw new BadRequestException(`Room ${dto.roomNumber} not found in this property`);
      }

      const [reservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.propertyId, propertyId),
            eq(reservations.roomId, room.id),
            inArray(reservations.status, IN_HOUSE_STATUSES as any),
          ),
        );
      if (!reservation) {
        throw new BadRequestException(
          `Room ${dto.roomNumber} is vacant or has no in-house reservation`,
        );
      }

      const [folio] = await tx
        .select({ id: folios.id })
        .from(folios)
        .where(
          and(
            eq(folios.propertyId, propertyId),
            eq(folios.reservationId, reservation.id),
            eq(folios.type, 'guest'),
          ),
        );
      if (!folio) {
        throw new BadRequestException(
          `No main folio found for in-house reservation ${reservation.id}`,
        );
      }

      const charge = await this.folioService.postCharge(
        folio.id,
        {
          propertyId,
          type: dto.type,
          description: dto.description ?? `${dto.type} charge`,
          amount: dto.amount,
          currencyCode: dto.currencyCode,
          serviceDate: dto.serviceDate ?? new Date().toISOString(),
        },
        tx,
      );

      await tx
        .update(folioInboundPosts)
        .set({ chargeId: charge.id })
        .where(
          and(
            eq(folioInboundPosts.propertyId, propertyId),
            eq(folioInboundPosts.vendorTxnId, dto.vendorTxnId),
          ),
        );

      return charge;
    });
  }

  private async returnExistingCharge(tx: any, propertyId: string, vendorTxnId: string) {
    const [existingPost] = await tx
      .select({ chargeId: folioInboundPosts.chargeId })
      .from(folioInboundPosts)
      .where(
        and(
          eq(folioInboundPosts.propertyId, propertyId),
          eq(folioInboundPosts.vendorTxnId, vendorTxnId),
        ),
      );

    if (!existingPost?.chargeId) {
      throw new ConflictException('Duplicate inbound charge is already being processed');
    }

    const [existingCharge] = await tx
      .select()
      .from(charges)
      .where(and(eq(charges.id, existingPost.chargeId), eq(charges.propertyId, propertyId)));

    if (!existingCharge) {
      throw new ConflictException('Duplicate inbound charge exists but the charge record is missing');
    }

    return existingCharge;
  }

  private isDuplicateVendorTxn(error: any): boolean {
    return (
      error?.code === '23505' ||
      String(error?.constraint ?? '').includes('folio_inbound_posts_property_vendor_unique')
    );
  }
}
