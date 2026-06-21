import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { rooms, roomTypes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  // --- Room Types ---

  async createRoomType(dto: CreateRoomTypeDto) {
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
