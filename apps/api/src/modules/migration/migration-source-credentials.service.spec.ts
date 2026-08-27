import { randomBytes } from 'node:crypto';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrationSourceCredentialsService } from './migration-source-credentials.service';

const KEY_HEX = randomBytes(32).toString('hex');

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: any[]) => ({ op: 'and', conditions })),
  desc: vi.fn((column: unknown) => ({ op: 'desc', column })),
  eq: vi.fn((column: unknown, value: unknown) => ({ op: 'eq', column, value })),
}));

vi.mock('@telivityhaip/database', () => ({
  // `database.module.ts` (imported transitively via `../auth/api-key.guard`
  // → `DRIZZLE`) now re-exports these two from `@telivityhaip/database`
  // itself (a single canonical `DRIZZLE` symbol shared across the optional
  // `@telivityhaip/booking-requests` package boundary) instead of defining
  // its own local symbol — this narrow mock must supply both so that static
  // import doesn't throw, even though this test never uses either value.
  DRIZZLE: Symbol('DRIZZLE-test-mock'),
  postgresOptionsFromEnv: vi.fn(() => ({})),
  auditLogs: {
    __table: 'auditLogs',
    propertyId: 'audit.propertyId',
    action: 'audit.action',
    entityType: 'audit.entityType',
    entityId: 'audit.entityId',
    description: 'audit.description',
    newValue: 'audit.newValue',
  },
  migrationSourceCredentials: {
    __table: 'migrationSourceCredentials',
    id: 'cred.id',
    propertyId: 'cred.propertyId',
    sourcePms: 'cred.sourcePms',
    ciphertext: 'cred.ciphertext',
    encryptionKeyId: 'cred.encryptionKeyId',
    createdAt: 'cred.createdAt',
    rotatedAt: 'cred.rotatedAt',
    updatedAt: 'cred.updatedAt',
  },
}));

const PROP = '11111111-1111-4111-8111-111111111111';
const OTHER_PROP = '22222222-2222-4222-8222-222222222222';
const CRED_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function metadataRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CRED_ID,
    propertyId: PROP,
    sourcePms: 'mews',
    encryptionKeyId: 'default',
    createdAt: CREATED_AT,
    rotatedAt: null,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createMockDb() {
  const state = {
    selectRows: [] as any[],
    insertRows: [] as any[],
    updateRows: [] as any[],
    deleteWhere: [] as any[],
    insertValues: [] as any[],
    updateSet: undefined as any,
    whereArgs: [] as any[],
    auditValues: [] as any[],
    storedCiphertext: '',
  };

  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((whereArg: any) => {
          state.whereArgs.push(whereArg);
          return {
            orderBy: vi.fn(() => Promise.resolve(state.selectRows)),
            limit: vi.fn(() =>
              Promise.resolve(
                state.selectRows.length > 0
                  ? state.selectRows
                  : state.storedCiphertext
                    ? [{ ciphertext: state.storedCiphertext, sourcePms: 'mews' }]
                    : [],
              ),
            ),
            then: (resolve: any, reject: any) =>
              Promise.resolve(state.selectRows).then(resolve, reject),
          };
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: any) => {
        state.insertValues.push(values);
        if ((table as any)?.__table === 'auditLogs') {
          state.auditValues.push(values);
          return Promise.resolve();
        }
        if (values.ciphertext) {
          state.storedCiphertext = values.ciphertext;
        }
        return {
          returning: vi.fn(() => Promise.resolve(state.insertRows)),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => {
        state.updateSet = values;
        if (values.ciphertext) {
          state.storedCiphertext = values.ciphertext;
        }
        return {
          where: vi.fn((whereArg: any) => {
            state.whereArgs.push(whereArg);
            return {
              returning: vi.fn(() => Promise.resolve(state.updateRows)),
            };
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((whereArg: any) => {
        state.deleteWhere.push(whereArg);
        return Promise.resolve();
      }),
    })),
  };

  return { db, state };
}

describe('MigrationSourceCredentialsService', () => {
  let mock: ReturnType<typeof createMockDb>;
  let service: MigrationSourceCredentialsService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      MIGRATION_CREDENTIAL_ENCRYPTION_KEY: KEY_HEX,
      MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID: 'default',
    };
    mock = createMockDb();
    service = new MigrationSourceCredentialsService(mock.db);
  });

  it('lists metadata without ciphertext or decrypted values', async () => {
    mock.state.selectRows = [metadataRow()];

    const result = await service.listMetadata(PROP);

    expect(result).toEqual([
      {
        id: CRED_ID,
        propertyId: PROP,
        sourcePms: 'mews',
        encryptionKeyId: 'default',
        createdAt: CREATED_AT,
        rotatedAt: null,
        updatedAt: CREATED_AT,
      },
    ]);
    expect(result[0]).not.toHaveProperty('ciphertext');
    expect(result[0]).not.toHaveProperty('credentials');
    expect(mock.state.whereArgs[0]).toEqual({
      op: 'eq',
      column: 'cred.propertyId',
      value: PROP,
    });
  });

  it('encrypts credentials at rest and audits without secret values', async () => {
    mock.state.selectRows = [];
    mock.state.insertRows = [metadataRow()];

    const result = await service.upsert(
      PROP,
      'mews',
      { clientToken: 'top-secret', accessToken: 'also-secret' },
      { userId: 'user-1', userEmail: 'admin@example.com', ipAddress: '127.0.0.1' },
    );

    expect(result).not.toHaveProperty('credentials');
    expect(result).not.toHaveProperty('ciphertext');
    expect(mock.state.insertValues[0].ciphertext).not.toContain('top-secret');
    expect(mock.state.insertValues[0].ciphertext).not.toContain('also-secret');
    expect(mock.state.insertValues[0]).toMatchObject({
      propertyId: PROP,
      sourcePms: 'mews',
      encryptionKeyId: 'default',
    });
    expect(mock.state.auditValues[0]).toMatchObject({
      propertyId: PROP,
      action: 'create',
      entityType: 'migration_source_credential',
      entityId: CRED_ID,
      description: 'migration_credential.created',
    });
    expect(JSON.stringify(mock.state.auditValues[0].newValue)).not.toContain('top-secret');
    expect(mock.state.auditValues[0].newValue).not.toHaveProperty('ciphertext');
  });

  it('round-trips credentials via decryptForRunner', async () => {
    mock.state.selectRows = [];
    mock.state.insertRows = [metadataRow()];
    await service.upsert(PROP, 'mews', { apiKey: 'runner-secret' });

    const decrypted = await service.decryptForRunner(PROP, 'mews');
    expect(decrypted).toEqual({ apiKey: 'runner-secret' });
  });

  it('fails closed when decrypting tampered ciphertext', async () => {
    mock.state.selectRows = [];
    mock.state.insertRows = [metadataRow()];
    await service.upsert(PROP, 'mews', { apiKey: 'runner-secret' });

    const parsed = JSON.parse(mock.state.storedCiphertext);
    parsed.authTag = '0'.repeat(parsed.authTag.length);
    mock.state.storedCiphertext = JSON.stringify(parsed);
    mock.state.selectRows = [{ ciphertext: mock.state.storedCiphertext, sourcePms: 'mews' }];

    await expect(service.decryptForRunner(PROP, 'mews')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects upsert when encryption key is not configured', async () => {
    delete process.env['MIGRATION_CREDENTIAL_ENCRYPTION_KEY'];
    await expect(
      service.upsert(PROP, 'mews', { apiKey: 'x' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('deletes credentials scoped by property and source PMS', async () => {
    mock.state.selectRows = [metadataRow()];

    const result = await service.delete(PROP, 'mews', {
      userId: 'user-1',
      userEmail: 'admin@example.com',
      ipAddress: '127.0.0.1',
    });

    expect(result).toEqual({ deleted: 1 });
    expect(mock.state.deleteWhere[0]).toEqual({
      op: 'and',
      conditions: [
        { op: 'eq', column: 'cred.propertyId', value: PROP },
        { op: 'eq', column: 'cred.sourcePms', value: 'mews' },
      ],
    });
    expect(mock.state.auditValues[0]).toMatchObject({
      action: 'delete',
      description: 'migration_credential.erased',
    });
    expect(mock.state.auditValues[0].newValue).not.toHaveProperty('ciphertext');
  });

  it('does not delete credentials from another tenant', async () => {
    mock.state.selectRows = [];

    await expect(service.delete(OTHER_PROP, 'mews')).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.state.deleteWhere).toEqual([]);
  });

  it('erases all credentials for a property when sourcePms is omitted', async () => {
    mock.state.selectRows = [
      metadataRow({ sourcePms: 'mews' }),
      metadataRow({ id: '44444444-4444-4444-8444-444444444444', sourcePms: 'apaleo' }),
    ];

    const result = await service.delete(PROP);

    expect(result).toEqual({ deleted: 2 });
    expect(mock.state.auditValues).toHaveLength(2);
    expect(mock.state.auditValues[0].description).toBe('migration_credential.erased_all');
  });
});
