import { Injectable, Logger } from '@nestjs/common';
import { DoorLockCredentialService } from '../door-lock-credential.service';
import type {
  AccessCredential,
  AccessCredentialRequest,
  LockProvider,
} from '../lock-provider.interface';
import { generateKeypadPin } from './lock-access-code.util';

const NUKI_API_BASE = 'https://api.nuki.io';

/**
 * Nuki Web API reference adapter.
 *
 * Env: `NUKI_API_TOKEN`, `NUKI_SMARTLOCK_ID` (default lock for the property deployment).
 * When credentials are absent, `isConfigured()` is false and {@link LockProviderFactory}
 * falls back to the console adapter.
 */
@Injectable()
export class NukiLockProvider implements LockProvider {
  readonly name = 'nuki';
  private readonly logger = new Logger(NukiLockProvider.name);
  private readonly token?: string;
  private readonly smartlockId?: string;

  constructor(private readonly credentials: DoorLockCredentialService) {
    this.token = process.env['NUKI_API_TOKEN']?.trim();
    this.smartlockId = process.env['NUKI_SMARTLOCK_ID']?.trim();
    if (!this.isConfigured()) {
      this.logger.log('Nuki not configured — door lock will fall back to console provider');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.smartlockId);
  }

  async issueCredential(req: AccessCredentialRequest): Promise<AccessCredential> {
    if (!this.token || !this.smartlockId) {
      throw new Error('Nuki not configured');
    }

    const accessCode = generateKeypadPin();
    const allowedFromDate = req.validFrom ?? new Date().toISOString();
    const body: Record<string, unknown> = {
      name: `HAIP ${req.reservationId.slice(0, 8)}`,
      type: 13,
      code: Number(accessCode),
      allowedFromDate,
    };
    if (req.validTo) body['allowedUntilDate'] = req.validTo;

    const res = await fetch(`${NUKI_API_BASE}/smartlock/${this.smartlockId}/auth`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Nuki issue failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as { id?: number };
    const credentialId = data.id != null ? String(data.id) : `nuki-${req.reservationId}`;
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
    if (!this.token || !this.smartlockId) {
      throw new Error('Nuki not configured');
    }

    const existing = await this.credentials.findByReservation(req.reservationId, req.propertyId);
    const authId = existing?.credentialId;
    if (authId) {
      const res = await fetch(`${NUKI_API_BASE}/smartlock/${this.smartlockId}/auth/${authId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text();
        throw new Error(`Nuki revoke failed (${res.status}): ${detail}`);
      }
    }

    await this.credentials.recordRevoked(req.propertyId, req.reservationId);
  }
}
