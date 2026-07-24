import { randomInt } from 'node:crypto';

/** Six-digit keypad PIN, zero-padded. CSPRNG — never Math.random for access codes. */
export function generateKeypadPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
