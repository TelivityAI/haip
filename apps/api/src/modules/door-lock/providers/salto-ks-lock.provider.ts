import { Injectable, Logger } from '@nestjs/common';
import { DoorLockCredentialService } from '../door-lock-credential.service';
import type {
  AccessCredential,
  AccessCredentialRequest,
  LockProvider,
} from '../lock-provider.interface';
import { generateKeypadPin } from './lock-access-code.util';

const SALTO_KS_IDENTITY = 'https://identity-acc.saltoks.com';
const SALTO_KS_API_BASE = process.env['SALTO_KS_API_BASE']?.trim() || 'https://api.saltoks.com';

/**
 * Salto KS Cloud reference adapter (site access user / PIN workflow).
 *
 * Env: `SALTO_KS_CLIENT_ID`, `SALTO_KS_CLIENT_SECRET`, `SALTO_KS_SITE_ID`.
 * Optional `SALTO_KS_API_BASE`, `SALTO_KS_IDENTITY_BASE`.
 */
@Injectable()
export class SaltoKsLockProvider implements LockProvider {
  readonly name = 'salto_ks';
  private readonly logger = new Logger(SaltoKsLockProvider.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly siteId?: string;
  private readonly identityBase: string;
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(private readonly credentials: DoorLockCredentialService) {
    this.clientId = process.env['SALTO_KS_CLIENT_ID']?.trim();
    this.clientSecret = process.env['SALTO_KS_CLIENT_SECRET']?.trim();
    this.siteId = process.env['SALTO_KS_SITE_ID']?.trim();
    this.identityBase = process.env['SALTO_KS_IDENTITY_BASE']?.trim() || SALTO_KS_IDENTITY;
    if (!this.isConfigured()) {
      this.logger.log('Salto KS not configured — door lock will fall back to console provider');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.siteId);
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
    });

    const res = await fetch(`${this.identityBase}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Salto KS token failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Salto KS token response missing access_token');
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  async issueCredential(req: AccessCredentialRequest): Promise<AccessCredential> {
    if (!this.isConfigured()) {
      throw new Error('Salto KS not configured');
    }

    const accessToken = await this.ensureAccessToken();
    const accessCode = generateKeypadPin();
    const payload = {
      firstName: 'Guest',
      lastName: req.reservationId.slice(0, 8),
      pin: accessCode,
      validFrom: req.validFrom ?? new Date().toISOString(),
      ...(req.validTo ? { validTo: req.validTo } : {}),
      externalId: req.reservationId,
    };

    const res = await fetch(`${SALTO_KS_API_BASE}/v1.1/sites/${this.siteId}/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Salto KS issue failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as { id?: string };
    const credentialId = data.id ?? `salto-ks-${req.reservationId}`;
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
      throw new Error('Salto KS not configured');
    }

    const existing = await this.credentials.findByReservation(req.reservationId, req.propertyId);
    const userId = existing?.credentialId;
    if (userId) {
      const accessToken = await this.ensureAccessToken();
      const res = await fetch(`${SALTO_KS_API_BASE}/v1.1/sites/${this.siteId}/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text();
        throw new Error(`Salto KS revoke failed (${res.status}): ${detail}`);
      }
    }

    await this.credentials.recordRevoked(req.propertyId, req.reservationId);
  }
}
