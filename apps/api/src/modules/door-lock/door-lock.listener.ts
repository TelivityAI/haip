import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { properties, rooms } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { LockProviderFactory } from './lock-provider.factory';
import type { WebhookPayload } from '../webhook/webhook.service';

@Injectable()
export class DoorLockListener {
  private readonly logger = new Logger(DoorLockListener.name);

  constructor(
    private readonly factory: LockProviderFactory,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  private async resolveContext(propertyId: string, roomId: string | null) {
    const [property] = await this.db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const preferred = (property?.settings as any)?.onlineCheckIn?.lockProvider as
      | string
      | undefined;
    const lock = this.factory.resolveForProperty(preferred);

    let externalLockId: string | null = null;
    if (roomId) {
      const [room] = await this.db
        .select({ externalLockId: rooms.externalLockId })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)));
      externalLockId = room?.externalLockId ?? null;
    }
    return { lock, externalLockId };
  }

  @OnEvent('reservation.checked_in')
  async onCheckIn(payload: WebhookPayload): Promise<void> {
    if (!payload?.propertyId || !payload?.entityId) return;
    const roomId = (payload.data?.['roomId'] as string | undefined) ?? null;
    try {
      const { lock, externalLockId } = await this.resolveContext(payload.propertyId, roomId);
      await lock.issueCredential({
        propertyId: payload.propertyId,
        reservationId: payload.entityId,
        roomId,
        externalLockId,
      });
    } catch (error: any) {
      this.logger.error(
        `Lock provisioning failed for reservation ${payload.entityId}: ${error?.message}`,
      );
    }
  }

  @OnEvent('reservation.checked_out')
  async onCheckOut(payload: WebhookPayload): Promise<void> {
    if (!payload?.propertyId || !payload?.entityId) return;
    const roomId = (payload.data?.['roomId'] as string | undefined) ?? null;
    try {
      const { lock, externalLockId } = await this.resolveContext(payload.propertyId, roomId);
      await lock.revokeCredential({
        propertyId: payload.propertyId,
        reservationId: payload.entityId,
        roomId,
        externalLockId,
      });
    } catch (error: any) {
      this.logger.error(
        `Lock revocation failed for reservation ${payload.entityId}: ${error?.message}`,
      );
    }
  }
}
