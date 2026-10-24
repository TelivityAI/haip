import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { rooms } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { LOCK_PROVIDER, type LockProvider } from './lock-provider.interface';
import type { WebhookPayload } from '../webhook/webhook.service';

/**
 * Bridges reservation lifecycle events to the door-lock provider: provision room
 * access on check-in, revoke it on check-out. Decoupled via the event bus so the
 * reservation flow has zero knowledge of lock vendors.
 *
 * Listeners must never throw — a lock-vendor outage must not break check-in — so
 * failures are caught and logged.
 */
@Injectable()
export class DoorLockListener {
  private readonly logger = new Logger(DoorLockListener.name);

  constructor(
    @Inject(LOCK_PROVIDER) private readonly lock: LockProvider,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  @OnEvent('reservation.checked_in')
  async onCheckIn(payload: WebhookPayload): Promise<void> {
    if (!payload?.propertyId || !payload?.entityId) return;
    const roomId = (payload.data?.['roomId'] as string | undefined) ?? null;
    try {
      let externalLockId: string | null = null;
      if (roomId) {
        const [room] = await this.db
          .select({ externalLockId: rooms.externalLockId })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, payload.propertyId)));
        externalLockId = room?.externalLockId ?? null;
      }
      await this.lock.issueCredential({
        propertyId: payload.propertyId,
        reservationId: payload.entityId,
        roomId,
        externalLockId,
      });
    } catch (error: any) {
      this.logger.error(`Lock provisioning failed for reservation ${payload.entityId}: ${error?.message}`);
    }
  }

  @OnEvent('reservation.checked_out')
  async onCheckOut(payload: WebhookPayload): Promise<void> {
    if (!payload?.propertyId || !payload?.entityId) return;
    const roomId = (payload.data?.['roomId'] as string | undefined) ?? null;
    try {
      await this.lock.revokeCredential({
        propertyId: payload.propertyId,
        reservationId: payload.entityId,
        roomId,
      });
    } catch (error: any) {
      this.logger.error(`Lock revocation failed for reservation ${payload.entityId}: ${error?.message}`);
    }
  }
}
