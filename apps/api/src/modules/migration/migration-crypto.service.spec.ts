import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MigrationCryptoService } from './migration-crypto.service';

const KEY = 'test-credential-key-material';

describe('MigrationCryptoService', () => {
  let svc: MigrationCryptoService;

  beforeEach(() => {
    process.env['MIGRATION_CREDENTIAL_KEY'] = KEY;
    delete process.env['MIGRATION_CREDENTIAL_KEY_PREVIOUS'];
    svc = new MigrationCryptoService();
    svc.onModuleInit();
  });

  afterEach(() => {
    delete process.env['MIGRATION_CREDENTIAL_KEY'];
  });

  it('round-trips a secret', () => {
    const { ciphertext, keyId } = svc.encrypt('mews-access-token-123');
    expect(keyId).toBe('default');
    expect(ciphertext).not.toContain('mews-access-token-123');
    expect(svc.decrypt(ciphertext)).toBe('mews-access-token-123');
  });

  it('produces unique ciphertext per call (random IV)', () => {
    const a = svc.encrypt('same-secret');
    const b = svc.encrypt('same-secret');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(svc.decrypt(a.ciphertext)).toBe('same-secret');
    expect(svc.decrypt(b.ciphertext)).toBe('same-secret');
  });

  it('fails closed when tampered (GCM auth tag)', () => {
    const { ciphertext } = svc.encrypt('secret');
    const parts = ciphertext.split('.');
    const data = Buffer.from(parts[4]!, 'base64');
    data[0] = data[0]! ^ 0xff;
    parts[4] = data.toString('base64');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects unknown payload formats and key ids', () => {
    expect(() => svc.decrypt('not-a-payload')).toThrow(/format/);
    expect(() => svc.decrypt('v1.unknown.aa.bb.cc')).toThrow(/key id/);
  });

  it('is disabled without a configured key', () => {
    delete process.env['MIGRATION_CREDENTIAL_KEY'];
    const bare = new MigrationCryptoService();
    bare.onModuleInit();
    expect(bare.isEnabled()).toBe(false);
    expect(() => bare.encrypt('x')).toThrow(/not configured/);
  });

  it('accepts hex keys and passphrases identically', () => {
    const hex = Buffer.from('key-material-32-bytes-exactly!!!')
      .toString('hex')
      .padEnd(64, '0');
    process.env['MIGRATION_CREDENTIAL_KEY'] = hex;
    const hexSvc = new MigrationCryptoService();
    hexSvc.onModuleInit();
    const { ciphertext } = hexSvc.encrypt('payload');
    expect(hexSvc.decrypt(ciphertext)).toBe('payload');
  });
});
