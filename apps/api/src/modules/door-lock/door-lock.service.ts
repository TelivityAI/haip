import { Injectable, Inject } from '@nestjs/common';
import { DoorLockCredentialService } from './door-lock-credential.service';
import { LOCK_PROVIDER, type LockProvider } from './lock-provider.interface';
import type { ListDoorLockCredentialsDto } from './dto/list-credentials.dto';

@Injectable()
export class DoorLockService {
  constructor(
    private readonly credentials: DoorLockCredentialService,
    @Inject(LOCK_PROVIDER) private readonly lock: LockProvider,
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

    await this.lock.issueCredential({
      propertyId,
      reservationId,
      roomId: reservation.roomId,
    });

    return this.credentials.findByReservation(reservationId, propertyId);
  }
}
