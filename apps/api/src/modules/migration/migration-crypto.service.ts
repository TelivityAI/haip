import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM for source-PMS credentials (TEL-70).
 *
 * Payload format: `v1.<kid>.<base64 iv>.<base64 tag>.<base64 ciphertext>`.
 * The `kid` segment lets ops rotate MIGRATION_CREDENTIAL_KEY without losing
 * existing rows — decryption tries the kid recorded on the row.
 *
 * Keys: `MIGRATION_CREDENTIAL_KEY` (current) and
 * `MIGRATION_CREDENTIAL_KEY_PREVIOUS` (rotation). Any 32-byte value works;
 * hex/base64/passphrase are all accepted and normalized with sha256.
 */
@Injectable()
export class MigrationCryptoService implements OnModuleInit {
  private readonly keys = new Map<string, Buffer>();
  private currentKid = 'default';

  onModuleInit() {
    const primary = process.env['MIGRATION_CREDENTIAL_KEY'];
    if (primary) {
      this.keys.set(this.currentKid, this.normalize(primary));
    }
    const previous = process.env['MIGRATION_CREDENTIAL_KEY_PREVIOUS'];
    if (previous) {
      this.keys.set('previous', this.normalize(previous));
    }
  }

  /** False when no key is configured — callers must fail closed. */
  isEnabled(): boolean {
    return this.keys.has(this.currentKid);
  }

  encrypt(plaintext: string): { ciphertext: string; keyId: string } {
    const key = this.keys.get(this.currentKid);
    if (!key) {
      throw new Error(
        'MIGRATION_CREDENTIAL_KEY is not configured — refusing to store credentials',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = [
      'v1',
      this.currentKid,
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
    return { ciphertext: payload, keyId: this.currentKid };
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') {
      throw new Error('Unrecognized credential payload format');
    }
    const [, kid, ivB64, tagB64, dataB64] = parts;
    const key = this.keys.get(kid!);
    if (!key) {
      throw new Error(`No decryption key for key id "${kid}"`);
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64!, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private normalize(raw: string): Buffer {
    // Accept hex (64 chars), base64 (32 bytes), or arbitrary passphrase.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) return b;
    } catch {
      /* fall through to passphrase hashing */
    }
    return createHash('sha256').update(raw, 'utf8').digest();
  }
}
