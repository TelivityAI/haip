import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { properties, rooms } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { DoorLockCredentialService } from './door-lock-credential.service';
import { LockProviderFactory } from './lock-provider.factory';
import type { ListDoorLockCredentialsDto } from './dto/list-credentials.dto';

@Injectable()
export class DoorLockService {
  constructor(
    private readonly credentials: DoorLockCredentialService,
    private readonly factory: LockProviderFactory,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  list(dto: ListDoorLockCredentialsDto) {
    return this.credentials.list(dto);
  }

  findByReservation(reservationId: string, propertyId: string) {
    return this.credentials.findByReservation(reservationId, propertyId);
  }

  async reissue(reservationId: string, propertyId: string) {
    const reservation = await this.credentials.getReservationRoom(propertyId, reservationId);
    this.credentials.assertCanIssue(reservation.status);

    const [property] = await this.db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const preferred = (property?.settings as any)?.onlineCheckIn?.lockProvider as
      | string
      | undefined;
    const lock = this.factory.resolveForProperty(preferred);

    let externalLockId: string | null = null;
    if (reservation.roomId) {
      const [room] = await this.db
        .select({ externalLockId: rooms.externalLockId })
        .from(rooms)
        .where(and(eq(rooms.id, reservation.roomId), eq(rooms.propertyId, propertyId)));
      externalLockId = room?.externalLockId ?? null;
    }

    await lock.issueCredential({
      propertyId,
      reservationId,
      roomId: reservation.roomId,
      externalLockId,
    });

    return this.credentials.findByReservation(reservationId, propertyId);
  }
}
