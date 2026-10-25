import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 16;
const KEY_BYTES = 32;
const ENVELOPE_MARKER = 'haip-id-image-v1';

export interface IdImageEnvelope {
  v: typeof ENVELOPE_MARKER;
  iv: string;
  authTag: string;
  ciphertext: string;
  contentType: string;
}

export function resolveIdEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  const hex = env['ID_ENCRYPTION_KEY']?.trim();
  if (!hex) return null;
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ID_ENCRYPTION_KEY must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes)`,
    );
  }
  return key;
}

/** Encrypt ID photo bytes. Returns a UTF-8 JSON envelope as a Buffer. */
export function encryptIdImageBuffer(
  plaintext: Buffer,
  contentType: string,
  env: NodeJS.ProcessEnv = process.env,
): { buffer: Buffer; encrypted: true } | { buffer: Buffer; encrypted: false } {
  const key = resolveIdEncryptionKey(env);
  if (!key) {
    return { buffer: plaintext, encrypted: false };
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: IdImageEnvelope = {
    v: ENVELOPE_MARKER,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('base64'),
    contentType,
  };
  return { buffer: Buffer.from(JSON.stringify(envelope), 'utf8'), encrypted: true };
}

/** Decrypt a stored envelope, or return the raw buffer if legacy plaintext. */
export function decryptIdImageBuffer(
  stored: Buffer,
  env: NodeJS.ProcessEnv = process.env,
): { buffer: Buffer; contentType?: string } {
  const asText = stored.toString('utf8');
  if (!asText.startsWith('{') || !asText.includes(ENVELOPE_MARKER)) {
    return { buffer: stored };
  }
  let parsed: IdImageEnvelope;
  try {
    parsed = JSON.parse(asText) as IdImageEnvelope;
  } catch {
    return { buffer: stored };
  }
  if (parsed?.v !== ENVELOPE_MARKER || !parsed.ciphertext || !parsed.iv || !parsed.authTag) {
    return { buffer: stored };
  }
  const key = resolveIdEncryptionKey(env);
  if (!key) {
    throw new Error('ID photo is encrypted but ID_ENCRYPTION_KEY is not configured');
  }
  const decipher = createDecipheriv(AES_ALGO, key, Buffer.from(parsed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'));
  const buffer = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return { buffer, contentType: parsed.contentType };
}
