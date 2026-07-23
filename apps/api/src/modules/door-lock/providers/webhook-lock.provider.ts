import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { WebhookService } from '../../webhook/webhook.service';
import { DoorLockCredentialService } from '../door-lock-credential.service';
import type {
  AccessCredential,
  AccessCredentialRequest,
  LockProvider,
} from '../lock-provider.interface';

/**
 * Reference lock adapter: emits `door.access_granted` / `door.access_revoked`
 * webhooks that a self-hoster's lock vendor (or middleware) subscribes to.
 *
 * It generates a 6-digit keypad PIN with a CSPRNG (randomInt — never Math.random
 * for anything access-related) and forwards the access window to the vendor via
 * the existing webhook delivery system. Swap this for a vendor SDK adapter by
 * rebinding the LOCK_PROVIDER token.
 */
@Injectable()
export class WebhookLockProvider implements LockProvider {
  readonly name = 'webhook';

  constructor(
    private readonly webhooks: WebhookService,
    private readonly credentials: DoorLockCredentialService,
  ) {}

  async issueCredential(req: AccessCredentialRequest): Promise<AccessCredential> {
    // 6-digit PIN, zero-padded. CSPRNG so codes aren't predictable.
    const accessCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const credentialId = `wlp-${req.reservationId}`;

    await this.webhooks.emit(
      'door.access_granted',
      'door_access',
      req.reservationId,
      {
        provider: this.name,
        credentialId,
        roomId: req.roomId ?? null,
        accessCode,
        validFrom: req.validFrom ?? new Date().toISOString(),
        ...(req.validTo ? { validTo: req.validTo } : {}),
      },
      req.propertyId,
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
    await this.webhooks.emit(
      'door.access_revoked',
      'door_access',
      req.reservationId,
      { provider: this.name, credentialId: `wlp-${req.reservationId}`, roomId: req.roomId ?? null },
      req.propertyId,
    );

    await this.credentials.recordRevoked(req.propertyId, req.reservationId);
  }
}
