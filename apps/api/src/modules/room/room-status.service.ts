import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { rooms, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
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
  // KB 5.2 chain: vacant_clean → vacant_dirty is the documented "clean room
  // found dirty" path — the desk must be able to send a room back to HK.
  vacant_clean: ['occupied', 'vacant_dirty', 'out_of_order', 'out_of_service'],
  vacant_dirty: ['clean', 'out_of_order'],
  // clean → vacant_dirty: inspection failed / return to housekeeping
  clean: ['inspected', 'vacant_clean', 'vacant_dirty', 'out_of_order'],
  // inspected / guest_ready → vacant_dirty: ready inventory found dirty
  inspected: ['guest_ready', 'vacant_dirty', 'out_of_order'],
  guest_ready: ['occupied', 'vacant_dirty', 'out_of_order'],
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
    actor?: AuditActor,
  ) {
    const room = await this.findRoom(roomId, propertyId);
    const currentStatus = room.status as RoomStatus;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition room from '${currentStatus}' to '${newStatus}'. Valid transitions: ${allowed.join(', ') || 'none'}`,
      );
    }

    const statusChanged = newStatus !== currentStatus;
    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };
    // `statusChangedAt` drives "how long has this room been out of order", so it
    // must move only when the status actually changes — never on a notes edit.
    if (statusChanged) updates['statusChangedAt'] = new Date();
    if (note !== undefined) {
      updates['maintenanceNotes'] = note;
    }

    const [updated] = await this.db
      .update(rooms)
      .set(updates)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)))
      .returning();

    // Operational audit trail: "who took 110 out of order and when".
    if (statusChanged) {
      await this.db.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'room_status',
        entityId: roomId,
        description: `room.status_changed ${currentStatus} -> ${newStatus}`,
        previousValue: { status: currentStatus, roomNumber: room.number },
        newValue: { status: newStatus, maintenanceNotes: note ?? null },
        ...actorFields(actor),
      });
    }

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

  /**
   * Current status age plus the recorded transitions for the rooms in scope.
   *
   * Answers "which rooms have been out of order for more than three days" from
   * `status_changed_at` instead of guessing from `updated_at` (which also moves
   * on notes-only edits), and returns the `room_status` audit rows so the answer
   * can name who made the change.
   */
  async getStatusHistory(
    propertyId: string,
    opts: { roomId?: string; status?: string; limit?: number; now?: Date } = {},
  ) {
    const now = opts.now ?? new Date();
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));

    const roomRows = await this.db
      .select({
        id: rooms.id,
        number: rooms.number,
        floor: rooms.floor,
        status: rooms.status,
        statusChangedAt: rooms.statusChangedAt,
        maintenanceNotes: rooms.maintenanceNotes,
        updatedAt: rooms.updatedAt,
      })
      .from(rooms)
      .where(
        and(
          eq(rooms.propertyId, propertyId),
          eq(rooms.isActive, true),
          opts.roomId ? eq(rooms.id, opts.roomId) : sql`true`,
          opts.status ? eq(rooms.status, opts.status as RoomStatus) : sql`true`,
        ),
      );

    const roomsWithAge = roomRows
      .map((room: Record<string, unknown>) => {
        const changedAt = room['statusChangedAt'] ? new Date(String(room['statusChangedAt'])) : null;
        const days = changedAt
          ? Math.max(0, Math.floor((now.getTime() - changedAt.getTime()) / 86_400_000))
          : null;
        return {
          roomId: room['id'],
          roomNumber: room['number'],
          floor: room['floor'] ?? null,
          status: room['status'],
          statusChangedAt: changedAt ? changedAt.toISOString() : null,
          daysInCurrentStatus: days,
          maintenanceNotes: room['maintenanceNotes'] ?? null,
        };
      })
      .sort((a: { daysInCurrentStatus: number | null }, b: { daysInCurrentStatus: number | null }) =>
        (b.daysInCurrentStatus ?? -1) - (a.daysInCurrentStatus ?? -1),
      );

    const historyRows = await this.db
      .select({
        id: auditLogs.id,
        entityId: auditLogs.entityId,
        description: auditLogs.description,
        previousValue: auditLogs.previousValue,
        newValue: auditLogs.newValue,
        userEmail: auditLogs.userEmail,
        occurredAt: auditLogs.occurredAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.propertyId, propertyId),
          eq(auditLogs.entityType, 'room_status'),
          opts.roomId ? eq(auditLogs.entityId, opts.roomId) : sql`true`,
        ),
      )
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit);

    return {
      count: roomsWithAge.length,
      asOf: now.toISOString(),
      rooms: roomsWithAge,
      historyCount: historyRows.length,
      history: historyRows,
      note:
        'daysInCurrentStatus is measured from the last status change, so a notes-only edit does not reset it. ' +
        'history holds recorded room_status transitions, newest first.',
    };
  }
}
