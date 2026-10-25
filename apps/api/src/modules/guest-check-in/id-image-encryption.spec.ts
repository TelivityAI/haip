import { describe, expect, it } from 'vitest';
import {
  decryptIdImageBuffer,
  encryptIdImageBuffer,
} from './id-image-encryption';

describe('id-image-encryption', () => {
  const key = 'b'.repeat(64);

  it('stores plaintext when ID_ENCRYPTION_KEY is unset', () => {
    const plain = Buffer.from('hello-id-photo-bytes-xxxxxxxx');
    const sealed = encryptIdImageBuffer(plain, 'image/jpeg', {});
    expect(sealed.encrypted).toBe(false);
    expect(sealed.buffer.equals(plain)).toBe(true);
  });

  it('round-trips encrypted ID photo bytes', () => {
    const plain = Buffer.from('hello-id-photo-bytes-xxxxxxxx');
    const sealed = encryptIdImageBuffer(plain, 'image/png', {
      ID_ENCRYPTION_KEY: key,
    });
    expect(sealed.encrypted).toBe(true);
    expect(sealed.buffer.equals(plain)).toBe(false);
    const opened = decryptIdImageBuffer(sealed.buffer, { ID_ENCRYPTION_KEY: key });
    expect(opened.buffer.equals(plain)).toBe(true);
    expect(opened.contentType).toBe('image/png');
  });

  it('returns legacy plaintext buffers unchanged', () => {
    const legacy = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const opened = decryptIdImageBuffer(legacy, { ID_ENCRYPTION_KEY: key });
    expect(opened.buffer.equals(legacy)).toBe(true);
  });
});
