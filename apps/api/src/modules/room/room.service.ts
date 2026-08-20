import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { rooms, roomTypes, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

/** Stay statuses that pin a physical room — retyping would desync reservation.roomTypeId. */
const ROOM_TYPE_MOVE_BLOCKING_RESERVATION_STATUSES = [
  'assigned',
  'checked_in',
  'stayover',
  'due_out',
] as const;

@Injectable()
export class RoomService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  // --- Room Types ---

  async createRoomType(dto: CreateRoomTypeDto & { propertyId: string }) {
    const [roomType] = await this.db
      .insert(roomTypes)
      .values(dto)
      .returning();
    return roomType;
  }

  async findAllRoomTypes(propertyId: string) {
    return this.db
      .select()
      .from(roomTypes)
      .where(
        and(eq(roomTypes.propertyId, propertyId), eq(roomTypes.isActive, true)),
      );
  }

  async findRoomTypeById(id: string, propertyId: string) {
    const [roomType] = await this.db
      .select()
      .from(roomTypes)
      .where(and(eq(roomTypes.id, id), eq(roomTypes.propertyId, propertyId)));
    if (!roomType) {
      throw new NotFoundException(`Room type ${id} not found`);
    }
    return roomType;
  }

  // --- Rooms ---

  async createRoom(dto: CreateRoomDto) {
    // FK ownership (security audit #5): verify the caller's roomTypeId belongs
    // to dto.propertyId before insert. Schema FK alone permits cross-tenant
    // links because it only constrains row id.
    const [rt] = await this.db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, dto.roomTypeId), eq(roomTypes.propertyId, dto.propertyId)));
    if (!rt) {
      throw new BadRequestException(`room type ${dto.roomTypeId} not found in this property`);
    }
    const [room] = await this.db.insert(rooms).values(dto).returning();
    return room;
  }

  async findAllRooms(propertyId: string, roomTypeId?: string) {
    const conditions = [
      eq(rooms.propertyId, propertyId),
      eq(rooms.isActive, true),
    ];
    if (roomTypeId) {
      conditions.push(eq(rooms.roomTypeId, roomTypeId));
    }
    return this.db
      .select()
      .from(rooms)
      .where(and(...conditions));
  }

  async findRoomById(id: string, propertyId: string) {
    const [room] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, id), eq(rooms.propertyId, propertyId)));
    if (!room) {
      throw new NotFoundException(`Room ${id} not found`);
    }
    return room;
  }

  async updateRoom(id: string, propertyId: string, dto: UpdateRoomDto) {
    const existing = await this.findRoomById(id, propertyId);

    // FK ownership: a roomTypeId in the update is client-supplied — verify it
    // belongs to THIS property before writing, or an update could re-point a
    // room at another tenant's type (same rule as inbound-reservation mapping).
    if (dto.roomTypeId && dto.roomTypeId !== existing.roomTypeId) {
      const [type] = await this.db
        .select({ id: roomTypes.id })
        .from(roomTypes)
        .where(and(eq(roomTypes.id, dto.roomTypeId), eq(roomTypes.propertyId, propertyId)));
      if (!type) {
        throw new NotFoundException(`Room type ${dto.roomTypeId} not found for this property`);
      }

      // Occupied / in-stay rooms must not change type — assign/check-in enforce
      // room.roomTypeId === reservation.roomTypeId; a silent retype breaks that.
      if (existing.status === 'occupied') {
        throw new BadRequestException(
          `Cannot move room ${existing.number} to another type while status is occupied`,
        );
      }

      const [linked] = await this.db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.propertyId, propertyId),
            eq(reservations.roomId, id),
            inArray(reservations.status, [...ROOM_TYPE_MOVE_BLOCKING_RESERVATION_STATUSES]),
          ),
        )
        .limit(1);
      if (linked) {
        throw new BadRequestException(
          `Cannot move room ${existing.number} to another type while it is linked to an active stay (${linked.id})`,
        );
      }
    }

    const [room] = await this.db
      .update(rooms)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(rooms.id, id), eq(rooms.propertyId, propertyId)))
      .returning();
    if (!room) {
      throw new NotFoundException(`Room ${id} not found`);
    }
    return room;
  }
}
