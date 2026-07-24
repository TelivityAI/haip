import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashConnectKey } from '../auth/api-key.guard';
import { ConnectCredentialsService } from './connect-credentials.service';

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: any[]) => ({ op: 'and', conditions })),
  desc: vi.fn((column: unknown) => ({ op: 'desc', column })),
  eq: vi.fn((column: unknown, value: unknown) => ({ op: 'eq', column, value })),
}));

vi.mock('@telivityhaip/database', () => ({
  auditLogs: {
    __table: 'auditLogs',
    propertyId: 'audit.propertyId',
    action: 'audit.action',
    entityType: 'audit.entityType',
    entityId: 'audit.entityId',
    description: 'audit.description',
    newValue: 'audit.newValue',
  },
  connectCredentials: {
    __table: 'connectCredentials',
    id: 'credential.id',
    propertyId: 'credential.propertyId',
    label: 'credential.label',
    scopes: 'credential.scopes',
    keyHash: 'credential.keyHash',
    isActive: 'credential.isActive',
    lastUsedAt: 'credential.lastUsedAt',
    createdAt: 'credential.createdAt',
    revokedAt: 'credential.revokedAt',
  },
}));

const PROP = '11111111-1111-4111-8111-111111111111';
const OTHER_PROP = '22222222-2222-4222-8222-222222222222';
const CRED = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: CRED,
    propertyId: PROP,
    label: 'Integration gateway',
    scopes: ['search', 'book'],
    isActive: true,
    lastUsedAt: null,
    createdAt: CREATED_AT,
    revokedAt: null,
    ...overrides,
  };
}

function createMockDb() {
  const state = {
    selectRows: [] as any[],
    insertRows: [] as any[],
    updateRows: [] as any[],
    insertValues: [] as any[],
    updateSet: undefined as any,
    whereArgs: [] as any[],
    auditValues: [] as any[],
  };

  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((whereArg: any) => {
          state.whereArgs.push(whereArg);
          return {
            orderBy: vi.fn(() => Promise.resolve(state.selectRows)),
            limit: vi.fn(() => Promise.resolve(state.selectRows)),
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
        return {
          returning: vi.fn(() => Promise.resolve(state.insertRows)),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => {
        state.updateSet = values;
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
  };

  return { db, state };
}

describe('ConnectCredentialsService', () => {
  let mock: ReturnType<typeof createMockDb>;
  let service: ConnectCredentialsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockDb();
    service = new ConnectCredentialsService(mock.db);
  });

  it('lists credential metadata without plaintext keys or hashes', async () => {
    mock.state.selectRows = [row()];

    const result = await service.list(PROP);

    expect(result).toEqual([
      {
        id: CRED,
        name: 'Integration gateway',
        propertyId: PROP,
        scopes: ['search', 'book'],
        createdAt: CREATED_AT,
        lastUsedAt: null,
        revoked: false,
      },
    ]);
    expect(result[0]).not.toHaveProperty('key');
    expect(result[0]).not.toHaveProperty('keyHash');
    expect(mock.state.whereArgs[0]).toEqual({
      op: 'eq',
      column: 'credential.propertyId',
      value: PROP,
    });
  });

  it('creates a credential, stores only the sha256 hash, and audits redacted metadata', async () => {
    mock.state.insertRows = [row()];

    const result = await service.create(
      PROP,
      { name: 'Integration gateway', scopes: ['search', 'book'] },
      { userId: 'user-1', userEmail: 'admin@example.com', ipAddress: '127.0.0.1' },
    );

    expect(result.key).toMatch(/^ck_live_/);
    expect(result).not.toHaveProperty('keyHash');
    expect(mock.state.insertValues[0]).toMatchObject({
      propertyId: PROP,
      label: 'Integration gateway',
      scopes: ['search', 'book'],
      keyHash: hashConnectKey(result.key),
    });
    expect(mock.state.insertValues[0]).not.toHaveProperty('key');
    expect(mock.state.auditValues[0]).toMatchObject({
      propertyId: PROP,
      action: 'create',
      entityType: 'connect_credential',
      entityId: CRED,
      description: 'connect_credential.created',
      userId: 'user-1',
      userEmail: 'admin@example.com',
      ipAddress: '127.0.0.1',
    });
    expect(mock.state.auditValues[0].newValue).not.toHaveProperty('key');
    expect(mock.state.auditValues[0].newValue).not.toHaveProperty('keyHash');
  });

  it('revokes credentials using id and propertyId tenant scope', async () => {
    mock.state.updateRows = [row({ isActive: false, revokedAt: new Date('2026-01-02T00:00:00Z') })];

    const result = await service.revoke(CRED, PROP);

    expect(result).toEqual({ revoked: true, id: CRED });
    expect(mock.state.updateSet).toMatchObject({ isActive: false });
    expect(mock.state.updateSet.revokedAt).toBeInstanceOf(Date);
    expect(mock.state.whereArgs[0]).toEqual({
      op: 'and',
      conditions: [
        { op: 'eq', column: 'credential.id', value: CRED },
        { op: 'eq', column: 'credential.propertyId', value: PROP },
      ],
    });
    expect(mock.state.auditValues[0]).toMatchObject({
      propertyId: PROP,
      action: 'delete',
      entityType: 'connect_credential',
      entityId: CRED,
      description: 'connect_credential.revoked',
    });
  });

  it('does not revoke a credential in another tenant', async () => {
    mock.state.updateRows = [];

    await expect(service.revoke(CRED, OTHER_PROP)).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.state.whereArgs[0]).toEqual({
      op: 'and',
      conditions: [
        { op: 'eq', column: 'credential.id', value: CRED },
        { op: 'eq', column: 'credential.propertyId', value: OTHER_PROP },
      ],
    });
    expect(mock.state.auditValues).toEqual([]);
  });
});
