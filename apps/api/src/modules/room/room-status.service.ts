// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { rooms } from '@inhotel-io/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';

type RoomStatus =
  | 'vacant_clean'
  | 'vacant_dirty'
  | 'clean'
  | 'inspected'
  | 'guest_ready'
  | 'occupied'
  | 'out_of_order'
  | 'out_of_service';

const VALID_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  vacant_clean: ['occupied', 'out_of_order', 'out_of_service'],
  vacant_dirty: ['clean', 'out_of_order'],
  clean: ['inspected', 'vacant_clean', 'out_of_order'],
  inspected: ['guest_ready', 'out_of_order'],
  guest_ready: ['occupied', 'out_of_order'],
  occupied: ['vacant_dirty'],
  out_of_order: ['vacant_dirty'],
  out_of_service: ['vacant_dirty'],
};

@Injectable()
export class RoomStatusService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  async transitionStatus(
    roomId: string,
    propertyId: string,
    newStatus: RoomStatus,
    note?: string,
  ) {
    const room = await this.findRoom(roomId, propertyId);
    const currentStatus = room.status as RoomStatus;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition room from '${currentStatus}' to '${newStatus}'. Valid transitions: ${allowed.join(', ') || 'none'}`,
      );
    }

    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };
    if (note !== undefined) {
      updates['maintenanceNotes'] = note;
    }

    const [updated] = await this.db
      .update(rooms)
      .set(updates)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)))
      .returning();

    await this.webhookService.emit(
      'room.status_changed',
      'room',
      updated.id,
      { previousStatus: currentStatus, newStatus, roomNumber: room.number },
      propertyId,
    );

    return updated;
  }

  async markOccupied(roomId: string, propertyId: string) {
    return this.transitionStatus(roomId, propertyId, 'occupied');
  }

  async markVacantDirty(roomId: string, propertyId: string) {
    return this.transitionStatus(roomId, propertyId, 'vacant_dirty');
  }

  async markOutOfOrder(roomId: string, propertyId: string, notes: string) {
    return this.transitionStatus(roomId, propertyId, 'out_of_order', notes);
  }

  async markBackInService(roomId: string, propertyId: string) {
    const room = await this.findRoom(roomId, propertyId);
    const currentStatus = room.status as RoomStatus;
    if (currentStatus !== 'out_of_order' && currentStatus !== 'out_of_service') {
      throw new BadRequestException(
        `Room is not out of order or out of service (current: ${currentStatus})`,
      );
    }
    return this.transitionStatus(roomId, propertyId, 'vacant_dirty');
  }

  async getRoomStatus(roomId: string, propertyId: string) {
    const room = await this.findRoom(roomId, propertyId);
    return { id: room.id, number: room.number, status: room.status };
  }

  async getRoomsByStatus(propertyId: string, status: string) {
    return this.db
      .select()
      .from(rooms)
      .where(
        and(
          eq(rooms.propertyId, propertyId),
          eq(rooms.status, status as RoomStatus),
          eq(rooms.isActive, true),
        ),
      );
  }

  async getPropertyRoomSummary(propertyId: string) {
    const result = await this.db
      .select({
        status: rooms.status,
        count: sql<number>`count(*)::int`,
      })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.isActive, true)))
      .groupBy(rooms.status);

    return result;
  }

  private async findRoom(roomId: string, propertyId: string) {
    const [room] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)));
    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    return room;
  }
}
