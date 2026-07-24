import { Injectable, Logger } from '@nestjs/common';
import { DoorLockCredentialService } from '../door-lock-credential.service';
import type {
  AccessCredential,
  AccessCredentialRequest,
  LockProvider,
} from '../lock-provider.interface';
import { generateKeypadPin } from './lock-access-code.util';

const TTLOCK_API_BASE = process.env['TTLOCK_API_BASE']?.trim() || 'https://euapi.ttlock.com';

/**
 * TTLock Open API reference adapter (keyboard PIN workflow).
 *
 * Env: `TTLOCK_CLIENT_ID`, `TTLOCK_CLIENT_SECRET`, `TTLOCK_USERNAME`, `TTLOCK_PASSWORD`,
 * `TTLOCK_LOCK_ID`. Optional `TTLOCK_API_BASE` (defaults to EU API host).
 */
@Injectable()
export class TtlockLockProvider implements LockProvider {
  readonly name = 'ttlock';
  private readonly logger = new Logger(TtlockLockProvider.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly lockId?: string;
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(private readonly credentials: DoorLockCredentialService) {
    this.clientId = process.env['TTLOCK_CLIENT_ID']?.trim();
    this.clientSecret = process.env['TTLOCK_CLIENT_SECRET']?.trim();
    this.username = process.env['TTLOCK_USERNAME']?.trim();
    this.password = process.env['TTLOCK_PASSWORD']?.trim();
    this.lockId = process.env['TTLOCK_LOCK_ID']?.trim();
    if (!this.isConfigured()) {
      this.logger.log('TTLock not configured — door lock will fall back to console provider');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.username && this.password && this.lockId);
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      username: this.username!,
      password: this.password!,
      grant_type: 'password',
    });

    const res = await fetch(`${TTLOCK_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`TTLock token failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('TTLock token response missing access_token');
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  async issueCredential(req: AccessCredentialRequest): Promise<AccessCredential> {
    if (!this.isConfigured()) {
      throw new Error('TTLock not configured');
    }

    const accessToken = await this.ensureAccessToken();
    const accessCode = generateKeypadPin();
    const startDate = req.validFrom ? Date.parse(req.validFrom) : Date.now();
    const endDate = req.validTo ? Date.parse(req.validTo) : startDate + 7 * 24 * 60 * 60 * 1000;

    const body = new URLSearchParams({
      clientId: this.clientId!,
      accessToken,
      lockId: this.lockId!,
      keyboardPwd: accessCode,
      keyboardPwdName: `HAIP ${req.reservationId.slice(0, 8)}`,
      startDate: String(startDate),
      endDate: String(endDate),
      addType: '2',
    });

    const res = await fetch(`${TTLOCK_API_BASE}/v3/keyboardPwd/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`TTLock issue failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as { keyboardPwdId?: number };
    const credentialId =
      data.keyboardPwdId != null ? String(data.keyboardPwdId) : `ttlock-${req.reservationId}`;
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
    if (!this.isConfigured()) {
      throw new Error('TTLock not configured');
    }

    const existing = await this.credentials.findByReservation(req.reservationId, req.propertyId);
    const keyboardPwdId = existing?.credentialId;
    if (keyboardPwdId) {
      const accessToken = await this.ensureAccessToken();
      const body = new URLSearchParams({
        clientId: this.clientId!,
        accessToken,
        lockId: this.lockId!,
        keyboardPwdId,
        deleteType: '2',
      });

      const res = await fetch(`${TTLOCK_API_BASE}/v3/keyboardPwd/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`TTLock revoke failed (${res.status}): ${detail}`);
      }
    }

    await this.credentials.recordRevoked(req.propertyId, req.reservationId);
  }
}
