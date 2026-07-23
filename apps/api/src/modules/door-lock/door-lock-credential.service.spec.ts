import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DoorLockCredentialService } from './door-lock-credential.service';
import { DRIZZLE } from '../../database/database.module';

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

describe('DoorLockCredentialService', () => {
  let service: DoorLockCredentialService;
  let db: any;

  function listSelectChain(rows: any[]) {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    };
  }

  function singleSelectChain(rows: any[]) {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: 'cred-1',
                propertyId: PROPERTY_ID,
                reservationId: RESERVATION_ID,
                accessCode: '123456',
                status: 'active',
              },
            ]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'cred-1', status: 'revoked' }]),
          }),
        }),
      }),
      select: vi.fn().mockImplementation(() => singleSelectChain([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoorLockCredentialService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    service = module.get(DoorLockCredentialService);
  });

  it('upserts an active credential on recordIssued', async () => {
    const row = await service.recordIssued({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      roomId: 'room-1',
      credential: { provider: 'webhook', credentialId: 'wlp-x', accessCode: '123456' },
    });

    expect(row.status).toBe('active');
    expect(db.insert).toHaveBeenCalled();
  });

  it('marks credential revoked scoped by property and reservation', async () => {
    const row = await service.recordRevoked(PROPERTY_ID, RESERVATION_ID);
    expect(row?.status).toBe('revoked');
  });

  it('findByReservation throws when not found', async () => {
    await expect(service.findByReservation(RESERVATION_ID, PROPERTY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists credentials filtered by property and status', async () => {
    const listRows = [{ id: 'cred-1', status: 'active', propertyId: PROPERTY_ID }];
    db.select
      .mockReturnValueOnce(listSelectChain(listRows))
      .mockReturnValueOnce(singleSelectChain([{ count: 1 }]));

    const result = await service.list({
      propertyId: PROPERTY_ID,
      status: 'active',
    });

    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('rejects issue for checked-out reservations', () => {
    expect(() => service.assertCanIssue('checked_out')).toThrow(BadRequestException);
    expect(() => service.assertCanIssue('checked_in')).not.toThrow();
  });
});
