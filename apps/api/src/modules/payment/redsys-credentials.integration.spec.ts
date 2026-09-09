import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLogs, integrationCatalogEntries, properties, propertyIntegrations } from '@telivityhaip/database';
import { IntegrationsService } from '../integrations/integrations.service';
import { PropertyIntegrationsController } from '../integrations/property-integrations.controller';
import { RedsysCredentialsService } from './redsys-credentials.service';

const databaseUrl = process.env.REDSYS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Redsys protected property credentials', () => {
  const client = postgres(databaseUrl ?? 'postgresql://localhost/unavailable');
  const db = drizzle(client);
  const service = new IntegrationsService(db);
  const controller = new PropertyIntegrationsController(service);
  const resolver = new RedsysCredentialsService(service, { get: () => undefined } as any);
  const secret = 'synthetic-signing-secret-only';
  let propertyId: string;

  beforeEach(async () => {
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY', '12'.repeat(32));
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID', 'default');
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEYS', '');
    propertyId = randomUUID();
    await db.insert(properties).values({ id: propertyId, name: 'Credential test', code: propertyId.slice(0, 20), countryCode: 'ES', timezone: 'Europe/Madrid', currencyCode: 'EUR', totalRooms: 1 });
    await db.insert(integrationCatalogEntries).values({ slug: 'redsys', category: 'Payments', name: 'Redsys', status: 'shipped', description: 'Redsys' }).onConflictDoNothing();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(auditLogs).where(eq(auditLogs.propertyId, propertyId));
    await db.delete(propertyIntegrations).where(eq(propertyIntegrations.propertyId, propertyId));
    await db.delete(properties).where(eq(properties.id, propertyId));
  });
  afterAll(async () => { await client.end(); });

  async function stored() {
    const [row] = await db.select().from(propertyIntegrations).where(and(eq(propertyIntegrations.propertyId, propertyId), eq(propertyIntegrations.catalogSlug, 'redsys')));
    return row;
  }

  it('encrypts signing keys at rest and resolves them only for the owning property', async () => {
    const response = await controller.upsert('redsys', propertyId, { enabled: true, config: { merchantCode: '999008881', terminal: '001', secretKey: secret } }, {});
    const row = await stored();
    expect(JSON.stringify(row.config)).not.toContain(secret);
    expect(row.config.secretKeyEncrypted).toEqual(expect.objectContaining({ keyId: 'default', ciphertext: expect.any(String), authTag: expect.any(String) }));
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(response.config).not.toHaveProperty('secretKeyEncrypted');
    expect((await resolver.resolveForProperty(propertyId))?.secretKey).toBe(secret);
    expect(await resolver.resolveForProperty(randomUUID())).toBeNull();
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.propertyId, propertyId));
    expect(JSON.stringify(audit, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(secret);
  });

  it.each(['secretKey', 'secret_key', 'clave'])('canonicalizes %s, masks every public response and preserves blank updates', async (key) => {
    const response = await controller.upsert('redsys', propertyId, { enabled: true, config: { merchantCode: '999008881', [key]: secret } }, {});
    const original = await stored();
    for (const item of [response, await controller.getOne('redsys', propertyId), ...(await controller.list(propertyId))]) {
      expect(JSON.stringify(item)).not.toContain(secret);
      for (const spelling of ['secretKey', 'secret_key', 'clave', 'secretKeyEncrypted']) expect(item.config).not.toHaveProperty(spelling);
    }
    expect(original.config).not.toHaveProperty(key);
    expect(original.config.secretKeyEncrypted).toBeDefined();
    await controller.upsert('redsys', propertyId, { enabled: false, config: { [key]: '  ', secretKeyMasked: 'ignore' } }, {});
    expect((await stored()).config).toEqual(original.config);
    await controller.upsert('redsys', propertyId, { enabled: true }, {});
    expect((await resolver.resolveForProperty(propertyId))?.secretKey).toBe(secret);
  });

  it.each(['secretKey', 'secret_key', 'clave'])('masks legacy %s from list/get without needing the encryption key', async (key) => {
    await db.insert(propertyIntegrations).values({ propertyId, catalogSlug: 'redsys', config: { [key]: secret } });
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY', '');
    for (const item of [await controller.getOne('redsys', propertyId), ...(await controller.list(propertyId))]) {
      expect(JSON.stringify(item)).not.toContain(secret);
      expect(item.config).not.toHaveProperty(key);
    }
  });

  it.each(['secretKey', 'secret_key', 'clave'])('upgrades legacy %s before resolving without changing another property', async (key) => {
    await db.insert(propertyIntegrations).values({ propertyId, catalogSlug: 'redsys', config: { merchantCode: '999008881', [key]: secret } });
    expect(await resolver.resolveForProperty(randomUUID())).toBeNull();
    expect((await stored()).config[key]).toBe(secret);
    expect((await resolver.resolveForProperty(propertyId))?.secretKey).toBe(secret);
    const row = await stored();
    expect(JSON.stringify(row.config)).not.toContain(secret);
    expect(row.config.secretKeyEncrypted).toBeDefined();
    const encrypted = row.config.secretKeyEncrypted;
    await resolver.resolveForProperty(propertyId);
    expect((await stored()).config.secretKeyEncrypted).toEqual(encrypted);
  });

  it('rejects caller-supplied ciphertext without overwriting stored credentials', async () => {
    await controller.upsert('redsys', propertyId, { enabled: true, config: { merchantCode: '999008881', secretKey: secret } }, {});
    const original = (await stored()).config;
    await expect(controller.upsert('redsys', propertyId, { enabled: true, config: { secretKeyEncrypted: { ciphertext: 'forged' } } }, {})).rejects.toThrow(/ciphertext/i);
    expect((await stored()).config).toEqual(original);
  });

  it('fails closed with unavailable encryption keys even when environment merchant credentials exist', async () => {
    await controller.upsert('redsys', propertyId, { enabled: true, config: { merchantCode: '999008881', secretKey: secret } }, {});
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY', '');
    const withFallback = new RedsysCredentialsService(service, { get: (key: string) => ({ REDSYS_MERCHANT_CODE: '111111111', REDSYS_SECRET_KEY: 'different-merchant-secret' })[key] } as any);
    await expect(withFallback.resolveForProperty(propertyId)).rejects.toThrow(/credentials.*unavailable/i);
  });

  it('leaves stored credentials unchanged when replacement encryption is unavailable', async () => {
    await controller.upsert('redsys', propertyId, { enabled: true, config: { merchantCode: '999008881', secretKey: secret } }, {});
    const original = (await stored()).config;
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY', '');
    await expect(controller.upsert('redsys', propertyId, { enabled: true, config: { secretKey: 'replacement-test-key' } }, {})).rejects.toThrow(/not configured/);
    expect((await stored()).config).toEqual(original);
  });

  it('decrypts a rotated legacy key and refuses tampered ciphertext', async () => {
    await controller.upsert('redsys', propertyId, { enabled: true, config: { merchantCode: '999008881', secretKey: secret } }, {});
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY', '34'.repeat(32));
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID', 'current');
    vi.stubEnv('MIGRATION_CREDENTIAL_ENCRYPTION_KEYS', JSON.stringify({ default: '12'.repeat(32) }));
    expect((await resolver.resolveForProperty(propertyId))?.secretKey).toBe(secret);
    const config = (await stored()).config;
    await db.update(propertyIntegrations).set({ config: { ...config, secretKeyEncrypted: { ...(config.secretKeyEncrypted as object), authTag: '00'.repeat(16) } } })
      .where(and(eq(propertyIntegrations.propertyId, propertyId), eq(propertyIntegrations.catalogSlug, 'redsys')));
    await expect(resolver.resolveForProperty(propertyId)).rejects.toThrow(/credentials.*unavailable/i);
  });
});
