import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { WalletPassService } from './wallet-pass.service';

describe('WalletPassService', () => {
  it('does not advertise Apple downloadPath (no dangling pkpass route)', () => {
    const svc = new WalletPassService({
      get: (k: string) =>
        ({
          APPLE_PASS_CERT_PEM: 'cert',
          APPLE_PASS_KEY_PEM: 'key',
          APPLE_PASS_TEAM_ID: 'team',
          APPLE_PASS_PASS_TYPE_ID: 'pass.type',
        })[k],
    } as any);
    const result = svc.build({
      propertyName: 'Demo',
      propertyId: 'p1',
      reservationId: 'r1',
      roomNumber: '101',
      accessCode: '123456',
      guestName: 'Ada',
    });
    expect(result.apple.available).toBe(false);
    expect(result.apple.downloadPath).toBeUndefined();
  });

  it('builds a Google Save URL when service-account material exists', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const svc = new WalletPassService({
      get: (k: string) =>
        ({
          GOOGLE_WALLET_ISSUER_ID: 'issuer',
          GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'sa@example.com',
          GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
        })[k],
    } as any);
    const result = svc.build({
      propertyName: 'Demo',
      propertyId: 'p1',
      reservationId: 'r1',
      roomNumber: '101',
      accessCode: '123456',
      guestName: 'Ada',
    });
    expect(result.google.available).toBe(true);
    expect(result.google.saveUrl).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  });
});
