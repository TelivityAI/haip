import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM encrypted blob with key-rotation metadata. */
export interface EncryptedCredentialBlob {
  keyId: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export type CredentialKeyRing = ReadonlyMap<string, Buffer>;

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 16;
const KEY_BYTES = 32;

export class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialEncryptionError';
  }
}

/** Parse a 64-char hex string into a 32-byte AES-256 key. */
export function parseAes256KeyHex(hex: string, label: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new CredentialEncryptionError(
      `${label} must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes)`,
    );
  }
  return key;
}

/**
 * Load encryption keys from env for migration source-PMS credentials.
 *
 * - `MIGRATION_CREDENTIAL_ENCRYPTION_KEY` — primary key (hex)
 * - `MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID` — id for the primary key (default: "default")
 * - `MIGRATION_CREDENTIAL_ENCRYPTION_KEYS` — optional JSON map of keyId → hex for rotation
 */
export function loadMigrationCredentialKeyRingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CredentialKeyRing {
  const keys = new Map<string, Buffer>();
  const primaryHex = env['MIGRATION_CREDENTIAL_ENCRYPTION_KEY'];
  const primaryId = env['MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID'] ?? 'default';
  if (primaryHex) {
    keys.set(primaryId, parseAes256KeyHex(primaryHex, 'MIGRATION_CREDENTIAL_ENCRYPTION_KEY'));
  }

  const extraJson = env['MIGRATION_CREDENTIAL_ENCRYPTION_KEYS'];
  if (extraJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extraJson);
    } catch {
      throw new CredentialEncryptionError(
        'MIGRATION_CREDENTIAL_ENCRYPTION_KEYS must be valid JSON',
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CredentialEncryptionError(
        'MIGRATION_CREDENTIAL_ENCRYPTION_KEYS must be a JSON object',
      );
    }
    for (const [id, hex] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof hex !== 'string') {
        throw new CredentialEncryptionError(
          `MIGRATION_CREDENTIAL_ENCRYPTION_KEYS["${id}"] must be a hex string`,
        );
      }
      keys.set(id, parseAes256KeyHex(hex, `MIGRATION_CREDENTIAL_ENCRYPTION_KEYS["${id}"]`));
    }
  }

  return keys;
}

/** Resolve the active key id + material for new encryptions. */
export function resolveActiveMigrationCredentialKey(
  keyRing: CredentialKeyRing,
  env: NodeJS.ProcessEnv = process.env,
): { keyId: string; key: Buffer } {
  if (keyRing.size === 0) {
    throw new CredentialEncryptionError(
      'MIGRATION_CREDENTIAL_ENCRYPTION_KEY is not configured',
    );
  }
  const activeId = env['MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID'] ?? 'default';
  const key = keyRing.get(activeId);
  if (!key) {
    throw new CredentialEncryptionError(
      `Active encryption key id "${activeId}" is not in the key ring`,
    );
  }
  return { keyId: activeId, key };
}

/** Encrypt a UTF-8 plaintext string with AES-256-GCM. */
export function encryptCredentialPlaintext(
  plaintext: string,
  keyRing: CredentialKeyRing,
  env: NodeJS.ProcessEnv = process.env,
): EncryptedCredentialBlob {
  const { keyId, key } = resolveActiveMigrationCredentialKey(keyRing, env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    keyId,
    iv: iv.toString('hex'),
    ciphertext,
    authTag,
  };
}

/** Decrypt an AES-256-GCM blob. Fails closed on wrong/missing key or tampered ciphertext. */
export function decryptCredentialPlaintext(
  blob: EncryptedCredentialBlob,
  keyRing: CredentialKeyRing,
): string {
  const key = keyRing.get(blob.keyId);
  if (!key) {
    throw new CredentialEncryptionError(
      `Encryption key id "${blob.keyId}" is not available`,
    );
  }
  const decipher = createDecipheriv(AES_ALGO, key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'hex'));
  try {
    let plaintext = decipher.update(blob.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    throw new CredentialEncryptionError('Credential decryption failed (wrong key or tampered data)');
  }
}

/** Serialize blob columns for DB storage (single text column). */
export function serializeEncryptedBlob(blob: EncryptedCredentialBlob): string {
  return JSON.stringify(blob);
}

/** Deserialize blob from DB storage. */
export function deserializeEncryptedBlob(serialized: string): EncryptedCredentialBlob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new CredentialEncryptionError('Stored credential ciphertext is not valid JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('keyId' in parsed) ||
    !('iv' in parsed) ||
    !('ciphertext' in parsed) ||
    !('authTag' in parsed)
  ) {
    throw new CredentialEncryptionError('Stored credential ciphertext is missing required fields');
  }
  const blob = parsed as EncryptedCredentialBlob;
  if (
    typeof blob.keyId !== 'string' ||
    typeof blob.iv !== 'string' ||
    typeof blob.ciphertext !== 'string' ||
    typeof blob.authTag !== 'string'
  ) {
    throw new CredentialEncryptionError('Stored credential ciphertext has invalid field types');
  }
  return blob;
}
