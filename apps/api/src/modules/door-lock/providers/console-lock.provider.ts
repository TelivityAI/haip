import { Injectable, Logger } from '@nestjs/common';
import { DoorLockCredentialService } from '../door-lock-credential.service';
import type {
  AccessCredential,
  AccessCredentialRequest,
  LockProvider,
} from '../lock-provider.interface';
import { generateKeypadPin } from './lock-access-code.util';

/**
 * Development/demo lock fallback — logs issue/revoke instead of calling a vendor API.
 *
 * Always configured so check-in never hard-fails when no lock credentials are set.
 * Persists credentials locally like production adapters so front-desk PIN display works.
 */
@Injectable()
export class ConsoleLockProvider implements LockProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleLockProvider.name);

  constructor(private readonly credentials: DoorLockCredentialService) {}

  isConfigured(): boolean {
    return true;
  }

  async issueCredential(req: AccessCredentialRequest): Promise<AccessCredential> {
    const accessCode = generateKeypadPin();
    const credentialId = `console-${req.reservationId}`;

    this.logger.log(
      `[door-lock:console] issue property=${req.propertyId} reservation=${req.reservationId} room=${req.roomId ?? '—'} pin=${accessCode}`,
    );

    const credential: AccessCredential = { provider: this.name, credentialId, accessCode };

    await this.credentials.recordIssued({
      propertyId: req.propertyId,
      reservationId: req.reservationId,
      roomId: req.roomId,
      credential,
    });

    return credential;
  }

  async revokeCredential(req: {
    propertyId: string;
    reservationId: string;
    roomId?: string | null;
  }): Promise<void> {
    this.logger.log(
      `[door-lock:console] revoke property=${req.propertyId} reservation=${req.reservationId} room=${req.roomId ?? '—'}`,
    );
    await this.credentials.recordRevoked(req.propertyId, req.reservationId);
  }
}
