import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, desc, sql, isNull, or } from 'drizzle-orm';
import { staffNotifications, staffNotificationReads } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { EventsGateway } from '../events/events.gateway';

export interface CreateStaffNotificationInput {
  propertyId: string;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'critical';
  sourceEvent?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
}

@Injectable()
export class StaffNotificationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(input: CreateStaffNotificationInput) {
    const [row] = await this.db
      .insert(staffNotifications)
      .values({
        propertyId: input.propertyId,
        userId: input.userId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        severity: input.severity ?? 'info',
        sourceEvent: input.sourceEvent ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
      })
      .returning();

    await this.webhookService.emit(
      'staff.notification_created',
      'staff_notification',
      row.id,
      {
        type: row.type,
        title: row.title,
        severity: row.severity,
      },
      input.propertyId,
    );

    this.eventsGateway.broadcastStaffNotification(input.propertyId, {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      severity: row.severity,
      createdAt: row.createdAt,
    });

    return row;
  }

  async listForUser(propertyId: string, userId: string, limit = 50) {
    const rows = await this.db
      .select({
        id: staffNotifications.id,
        propertyId: staffNotifications.propertyId,
        type: staffNotifications.type,
        title: staffNotifications.title,
        message: staffNotifications.message,
        severity: staffNotifications.severity,
        sourceEvent: staffNotifications.sourceEvent,
        sourceEntityType: staffNotifications.sourceEntityType,
        sourceEntityId: staffNotifications.sourceEntityId,
        createdAt: staffNotifications.createdAt,
        readAt: staffNotificationReads.readAt,
      })
      .from(staffNotifications)
      .leftJoin(
        staffNotificationReads,
        and(
          eq(staffNotificationReads.notificationId, staffNotifications.id),
          eq(staffNotificationReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(staffNotifications.propertyId, propertyId),
          or(isNull(staffNotifications.userId), eq(staffNotifications.userId, userId)),
        ),
      )
      .orderBy(desc(staffNotifications.createdAt))
      .limit(limit);

    return rows.map((r: { readAt: Date | null }) => ({
      ...r,
      isRead: r.readAt != null,
    }));
  }

  async unreadCount(propertyId: string, userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(staffNotifications)
      .leftJoin(
        staffNotificationReads,
        and(
          eq(staffNotificationReads.notificationId, staffNotifications.id),
          eq(staffNotificationReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(staffNotifications.propertyId, propertyId),
          or(isNull(staffNotifications.userId), eq(staffNotifications.userId, userId)),
          sql`${staffNotificationReads.id} is null`,
        ),
      );
    return row?.count ?? 0;
  }

  async markRead(notificationId: string, propertyId: string, userId: string) {
    const [notification] = await this.db
      .select()
      .from(staffNotifications)
      .where(
        and(
          eq(staffNotifications.id, notificationId),
          eq(staffNotifications.propertyId, propertyId),
        ),
      );
    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    await this.db
      .insert(staffNotificationReads)
      .values({ notificationId, userId })
      .onConflictDoNothing();

    return { read: true };
  }

  async markAllRead(propertyId: string, userId: string) {
    const unread = await this.db
      .select({ id: staffNotifications.id })
      .from(staffNotifications)
      .leftJoin(
        staffNotificationReads,
        and(
          eq(staffNotificationReads.notificationId, staffNotifications.id),
          eq(staffNotificationReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(staffNotifications.propertyId, propertyId),
          or(isNull(staffNotifications.userId), eq(staffNotifications.userId, userId)),
          sql`${staffNotificationReads.id} is null`,
        ),
      );

    if (unread.length) {
      await this.db.insert(staffNotificationReads).values(
        unread.map((r: { id: string }) => ({
          notificationId: r.id,
          userId,
        })),
      ).onConflictDoNothing();
    }

    return { marked: unread.length };
  }
}
