import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

export interface WalletPassInput {
  propertyName: string;
  propertyId: string;
  reservationId: string;
  roomNumber: string | null;
  accessCode: string | null;
  guestName: string;
  validFrom?: string | null;
  validTo?: string | null;
  instructions?: string | null;
  mobileKeyDeepLink?: string | null;
}

export interface WalletPassResult {
  walletEnabled: boolean;
  apple: {
    available: boolean;
    /** Download path for a signed .pkpass when Apple Pass certs are configured. */
    downloadPath?: string;
    /** Inline pass fields for UI preview / Add to Wallet when certs are absent. */
    preview: Record<string, string>;
  };
  google: {
    available: boolean;
    /** Google Wallet save URL when issuer credentials are configured. */
    saveUrl?: string;
    preview: Record<string, string>;
  };
  /** Vendor BLE / NFC deep link when the lock provider issued a mobile key. */
  mobileKeyDeepLink?: string | null;
}

/**
 * Builds Apple/Google Wallet pass payloads for room access.
 *
 * Real .pkpass / Google save URLs require operator certificates (APPLE_PASS_* /
 * GOOGLE_WALLET_*). Without them we still return a consistent preview so the
 * guest UI can show "Add to Wallet" with copy-code fallback.
 */
@Injectable()
export class WalletPassService {
  constructor(private readonly config: ConfigService) {}

  build(input: WalletPassInput): WalletPassResult {
    const preview: Record<string, string> = {
      propertyName: input.propertyName,
      guestName: input.guestName,
      roomNumber: input.roomNumber ?? 'TBD',
      accessCode: input.accessCode ?? '',
      validFrom: input.validFrom ?? '',
      validTo: input.validTo ?? '',
      instructions: input.instructions ?? '',
    };

    const appleConfigured = Boolean(
      this.config.get('APPLE_PASS_CERT_PEM') && this.config.get('APPLE_PASS_KEY_PEM'),
    );
    const googleIssuer = this.config.get<string>('GOOGLE_WALLET_ISSUER_ID');
    const googleKey = this.config.get<string>('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL');

    let googleSaveUrl: string | undefined;
    if (googleIssuer && googleKey && input.accessCode) {
      // Compact JWT-style claim the client can open; full Google Wallet API
      // signing uses the service account when operators configure it.
      const claims = {
        iss: googleKey,
        aud: 'google',
        typ: 'savetowallet',
        payload: {
          genericObjects: [
            {
              id: `${googleIssuer}.${input.reservationId}`,
              cardTitle: { defaultValue: { language: 'en', value: input.propertyName } },
              header: { defaultValue: { language: 'en', value: `Room ${preview['roomNumber']}` } },
              textModulesData: [
                { header: 'Access code', body: input.accessCode },
                ...(input.instructions
                  ? [{ header: 'Instructions', body: input.instructions }]
                  : []),
              ],
            },
          ],
        },
      };
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const sig = createHmac(
        'sha256',
        this.config.get<string>('GOOGLE_WALLET_HMAC_SECRET') ||
          this.config.get<string>('CHECK_IN_MAGIC_SECRET') ||
          'dev-wallet-secret',
      )
        .update(body)
        .digest('base64url');
      googleSaveUrl = `https://pay.google.com/gp/v/save/${body}.${sig}`;
    }

    return {
      walletEnabled: true,
      apple: {
        available: appleConfigured,
        downloadPath: appleConfigured
          ? `/api/v1/guest-check-in/wallet/apple.pkpass`
          : undefined,
        preview,
      },
      google: {
        available: Boolean(googleSaveUrl),
        saveUrl: googleSaveUrl,
        preview,
      },
      mobileKeyDeepLink: input.mobileKeyDeepLink ?? null,
    };
  }
}
