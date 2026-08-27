import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type ConfirmationEntropy = (bytes: number) => Uint8Array;

/** A cryptographically random guest-facing bearer credential (128 bits of entropy). */
export function generateConfirmationNumber(
  entropy: ConfirmationEntropy = randomBytes,
): string {
  const bytes = entropy(16);
  if (bytes.length !== 16) {
    throw new Error('Confirmation entropy source must return 16 bytes');
  }
  let token = '';
  for (const byte of bytes) {
    token += CROCKFORD[byte & 0x1f];
    token += CROCKFORD[(byte >> 5) & 0x1f];
  }
  return `HAIP-${token}`;
}

/** Crockford base32 token without the HAIP- prefix (for channel/connect prefixes). */
export function generateConfirmationToken(
  entropy: ConfirmationEntropy = randomBytes,
): string {
  const confirmation = generateConfirmationNumber(entropy);
  return confirmation.startsWith('HAIP-') ? confirmation.slice(5) : confirmation;
}
