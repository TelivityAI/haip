import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CredentialEncryptionError,
  decryptCredentialPlaintext,
  encryptCredentialPlaintext,
  loadMigrationCredentialKeyRingFromEnv,
  parseAes256KeyHex,
  serializeEncryptedBlob,
  deserializeEncryptedBlob,
} from './credential-encryption';

const KEY_A = randomBytes(32).toString('hex');
const KEY_B = randomBytes(32).toString('hex');

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    MIGRATION_CREDENTIAL_ENCRYPTION_KEY: KEY_A,
    MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID: 'default',
    ...overrides,
  };
}

describe('credential-encryption', () => {
  it('round-trips plaintext', () => {
    const keyRing = loadMigrationCredentialKeyRingFromEnv(env());
    const blob = encryptCredentialPlaintext('{"apiKey":"secret"}', keyRing, env());
    const out = decryptCredentialPlaintext(blob, keyRing);
    expect(out).toBe('{"apiKey":"secret"}');
  });

  it('fails closed when decrypting with a wrong key ring', () => {
    const keyRing = loadMigrationCredentialKeyRingFromEnv(env());
    const blob = encryptCredentialPlaintext('sensitive', keyRing, env());
    const wrongRing = loadMigrationCredentialKeyRingFromEnv(
      env({ MIGRATION_CREDENTIAL_ENCRYPTION_KEY: KEY_B }),
    );
    expect(() => decryptCredentialPlaintext(blob, wrongRing)).toThrow(CredentialEncryptionError);
  });

  it('fails closed when the GCM auth tag is tampered', () => {
    const keyRing = loadMigrationCredentialKeyRingFromEnv(env());
    const blob = encryptCredentialPlaintext('sensitive', keyRing, env());
    const tampered = { ...blob, authTag: '0'.repeat(blob.authTag.length) };
    expect(() => decryptCredentialPlaintext(tampered, keyRing)).toThrow(CredentialEncryptionError);
  });

  it('fails closed when ciphertext is tampered', () => {
    const keyRing = loadMigrationCredentialKeyRingFromEnv(env());
    const blob = encryptCredentialPlaintext('sensitive', keyRing, env());
    // Deterministic tamper: change the first hex DIGIT to a different value.
    // Two dead ends this avoids, both no-ops that decode to identical bytes:
    //   - replace(/a/g,'b') does nothing when the ciphertext contains no 'a'
    //   - flipping to uppercase 'A' does nothing when the digit was 'a' ('A'==='a' as hex)
    // '0'<->'1' are distinct nibble values, both valid hex, so the bytes always change.
    const first = blob.ciphertext[0];
    const tampered = { ...blob, ciphertext: (first === '0' ? '1' : '0') + blob.ciphertext.slice(1) };
    expect(() => decryptCredentialPlaintext(tampered, keyRing)).toThrow(CredentialEncryptionError);
  });

  it('decrypts with a rotated legacy key id from the key ring', () => {
    const legacyEnv = env({
      MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID: 'legacy',
      MIGRATION_CREDENTIAL_ENCRYPTION_KEY: KEY_B,
      MIGRATION_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ legacy: KEY_B }),
    });
    const legacyRing = loadMigrationCredentialKeyRingFromEnv(legacyEnv);
    const blob = encryptCredentialPlaintext('rotated-secret', legacyRing, legacyEnv);
    expect(blob.keyId).toBe('legacy');

    const currentRing = loadMigrationCredentialKeyRingFromEnv(
      env({
        MIGRATION_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ legacy: KEY_B }),
      }),
    );
    expect(decryptCredentialPlaintext(blob, currentRing)).toBe('rotated-secret');
  });

  it('serializes and deserializes blobs for DB storage', () => {
    const keyRing = loadMigrationCredentialKeyRingFromEnv(env());
    const blob = encryptCredentialPlaintext('x', keyRing, env());
    const roundTrip = deserializeEncryptedBlob(serializeEncryptedBlob(blob));
    expect(roundTrip).toEqual(blob);
  });

  it('rejects invalid key hex length', () => {
    expect(() => parseAes256KeyHex('abcd', 'test')).toThrow(CredentialEncryptionError);
  });
});
