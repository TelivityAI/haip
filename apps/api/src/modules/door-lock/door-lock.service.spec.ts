import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { DoorLockService } from './door-lock.service';
import { DoorLockCredentialService } from './door-lock-credential.service';
import { LockProviderFactory } from './lock-provider.factory';
import { DRIZZLE } from '../../database/database.module';

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

describe('DoorLockService', () => {
  let service: DoorLockService;
  const credentials = {
    list: vi.fn(),
    findByReservation: vi.fn(),
    getReservationRoom: vi.fn(),
    assertCanIssue: vi.fn(),
  };
  const lock = {
    issueCredential: vi.fn().mockResolvedValue({
      provider: 'webhook',
      credentialId: 'wlp-x',
      accessCode: '654321',
    }),
  };
  const factory = {
    resolveForProperty: vi.fn().mockReturnValue(lock),
  };
  const db = {
    select: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    credentials.getReservationRoom.mockResolvedValue({
      id: RESERVATION_ID,
      roomId: 'room-9',
      status: 'checked_in',
    });
    credentials.findByReservation.mockResolvedValue({
      reservationId: RESERVATION_ID,
      accessCode: '654321',
      status: 'active',
    });
    factory.resolveForProperty.mockReturnValue(lock);
    db.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ settings: {}, externalLockId: 'ext-lock-1' }]),
      }),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoorLockService,
        { provide: DoorLockCredentialService, useValue: credentials },
        { provide: LockProviderFactory, useValue: factory },
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    service = module.get(DoorLockService);
  });

  it('reissues via lock provider then returns persisted row', async () => {
    const row = await service.reissue(RESERVATION_ID, PROPERTY_ID);

    expect(factory.resolveForProperty).toHaveBeenCalled();
    expect(lock.issueCredential).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      roomId: 'room-9',
      externalLockId: 'ext-lock-1',
    });
    expect(credentials.findByReservation).toHaveBeenCalledWith(RESERVATION_ID, PROPERTY_ID);
    expect(row.accessCode).toBe('654321');
  });
});
