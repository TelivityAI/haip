import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { lostAndFoundItems, rooms, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import {
  type CreateLostAndFoundItemDto,
  type UpdateLostAndFoundItemDto,
  type ListLostAndFoundItemsDto,
} from './dto/lost-and-found.dto';

const RETENTION_DAYS = 90;

@Injectable()
export class LostAndFoundService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  private generateTagCode(): string {
    const suffix = Date.now().toString(36).toUpperCase();
    return `LNF-${suffix}`;
  }

  private async verifyRoomOwnership(roomId: string, propertyId: string) {
    const [row] = await this.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`room ${roomId} not found in this property`);
    }
  }

  private async verifyReservationOwnership(reservationId: string, propertyId: string) {
    const [row] = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`reservation ${reservationId} not found in this property`);
    }
  }

  private async verifyGuestAtProperty(guestId: string, propertyId: string) {
    const [row] = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.guestId, guestId), eq(reservations.propertyId, propertyId)))
      .limit(1);
    if (!row) {
      throw new BadRequestException(`guest ${guestId} has no reservation at this property`);
    }
  }

  async create(dto: CreateLostAndFoundItemDto) {
    if (dto.roomId) await this.verifyRoomOwnership(dto.roomId, dto.propertyId);
    if (dto.reservationId) await this.verifyReservationOwnership(dto.reservationId, dto.propertyId);
    if (dto.guestId) await this.verifyGuestAtProperty(dto.guestId, dto.propertyId);

    const foundAt = dto.foundAt ? new Date(dto.foundAt) : new Date();
    const disposeAfter = new Date(foundAt);
    disposeAfter.setDate(disposeAfter.getDate() + RETENTION_DAYS);

    const [item] = await this.db
      .insert(lostAndFoundItems)
      .values({
        propertyId: dto.propertyId,
        roomId: dto.roomId,
        reservationId: dto.reservationId,
        guestId: dto.guestId,
        category: dto.category ?? 'general',
        description: dto.description,
        tagCode: this.generateTagCode(),
        status: 'held',
        foundAt,
        disposeAfter,
        notes: dto.notes,
      })
      .returning();

    return item;
  }

  async list(dto: ListLostAndFoundItemsDto) {
    const conditions = [eq(lostAndFoundItems.propertyId, dto.propertyId)];
    if (dto.status) {
      conditions.push(eq(lostAndFoundItems.status, dto.status as any));
    }
    if (dto.category) {
      conditions.push(eq(lostAndFoundItems.category, dto.category as any));
    }

    return this.db
      .select()
      .from(lostAndFoundItems)
      .where(and(...conditions))
      .orderBy(desc(lostAndFoundItems.foundAt));
  }

  async findById(id: string, propertyId: string) {
    const [item] = await this.db
      .select()
      .from(lostAndFoundItems)
      .where(and(eq(lostAndFoundItems.id, id), eq(lostAndFoundItems.propertyId, propertyId)));
    if (!item) {
      throw new NotFoundException(`Lost and found item ${id} not found`);
    }
    return item;
  }

  async update(id: string, propertyId: string, dto: UpdateLostAndFoundItemDto) {
    await this.findById(id, propertyId);

    if (dto.roomId) await this.verifyRoomOwnership(dto.roomId, propertyId);
    if (dto.reservationId) await this.verifyReservationOwnership(dto.reservationId, propertyId);
    if (dto.guestId) await this.verifyGuestAtProperty(dto.guestId, propertyId);

    const [item] = await this.db
      .update(lostAndFoundItems)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(lostAndFoundItems.id, id), eq(lostAndFoundItems.propertyId, propertyId)))
      .returning();

    return item;
  }

  async delete(id: string, propertyId: string) {
    const [item] = await this.db
      .delete(lostAndFoundItems)
      .where(and(eq(lostAndFoundItems.id, id), eq(lostAndFoundItems.propertyId, propertyId)))
      .returning();
    if (!item) {
      throw new NotFoundException(`Lost and found item ${id} not found`);
    }
    return item;
  }
}
