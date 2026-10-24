import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';

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
    downloadPath?: string;
    preview: Record<string, string>;
  };
  google: {
    available: boolean;
    saveUrl?: string;
    preview: Record<string, string>;
  };
  mobileKeyDeepLink?: string | null;
}

/**
 * Honest Wallet payloads: only advertise Apple/Google when issuer material exists.
 * Universal product is always the PIN preview — never a fake save URL.
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

    // Apple .pkpass packaging needs Pass Type ID certs + a real signer.
    // Do not advertise downloadPath until a working pkpass endpoint ships —
    // PIN + Google Save (when issuer SA is configured) are the honest products.
    const appleConfigured = false;

    const googleSaveUrl = this.buildGoogleSaveUrl(input, preview);

    return {
      walletEnabled: Boolean(googleSaveUrl),
      apple: {
        available: appleConfigured,
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

  /**
   * Google Wallet "Save" JWT when service-account PEM + issuer id are configured.
   * Uses RS256 signed JWT (not a fake HMAC URL).
   */
  private buildGoogleSaveUrl(
    input: WalletPassInput,
    preview: Record<string, string>,
  ): string | undefined {
    const issuerId = this.config.get<string>('GOOGLE_WALLET_ISSUER_ID')?.trim();
    const saEmail = this.config.get<string>('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL')?.trim();
    const saKey = this.config.get<string>('GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY')?.trim();
    if (!issuerId || !saEmail || !saKey || !input.accessCode) return undefined;

    try {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const claims = {
        iss: saEmail,
        aud: 'google',
        typ: 'savetowallet',
        iat: now,
        payload: {
          genericObjects: [
            {
              id: `${issuerId}.${input.reservationId}`,
              cardTitle: {
                defaultValue: { language: 'en', value: input.propertyName },
              },
              header: {
                defaultValue: {
                  language: 'en',
                  value: `Room ${preview['roomNumber']}`,
                },
              },
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
      const enc = (obj: unknown) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url');
      const unsigned = `${enc(header)}.${enc(claims)}`;
      const pem = saKey.includes('\\n') ? saKey.replace(/\\n/g, '\n') : saKey;
      const signer = createSign('RSA-SHA256');
      signer.update(unsigned);
      signer.end();
      const signature = signer.sign(pem).toString('base64url');
      return `https://pay.google.com/gp/v/save/${unsigned}.${signature}`;
    } catch {
      return undefined;
    }
  }
}
