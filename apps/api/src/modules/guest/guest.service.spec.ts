import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GuestService } from './guest.service';
import { DRIZZLE } from '../../database/database.module';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';

const mockGuest = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  firstName: 'John',
  lastName: 'Smith',
  email: 'john@example.com',
  phone: '+1-555-0100',
  vipLevel: 'gold',
  isDnr: false,
  dnrReason: null,
  dnrDate: null,
  loyaltyNumber: 'LY12345',
  preferences: { bedType: 'king' },
  gdprConsentMarketing: false,
  gdprConsentDate: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Build a mock Drizzle DB where:
 *  - select queries that terminate on .where() resolve to `selectData`
 *  - select queries that terminate on .limit().offset().orderBy() resolve to `selectData`
 *  - a separate `reservationLink` controls the propertyId-scoping precheck
 *    (assertGuestAtProperty → select({id}).from(reservations).where().limit())
 *  - insert/update/delete .returning() resolve to `selectData`
 *
 * Call-order contract for the pre-check: the first select() that terminates on
 * .limit(1) is treated as the reservation link query.
 */
function createMockDb(options: {
  selectData?: any[];
  reservationLink?: any[]; // rows returned by the .limit(1) precheck
} = {}) {
  const selectData = options.selectData ?? [mockGuest];
  const reservationLink = options.reservationLink ?? [{ id: 'res-1' }];

  const mutateChain = () => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(selectData),
    }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(selectData),
      }),
    }),
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(selectData),
    }),
  });

  // The select() mock distinguishes the two shapes: the reservation-link
  // precheck terminates on .limit(1); every other select terminates on
  // .where() or .orderBy() (paginated) or .where() (count).
  const selectMock: any = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        // Precheck: .limit(n) → Promise<rows>
        limit: vi.fn().mockResolvedValue(reservationLink),
        // Paginated listing: .limit().offset().orderBy()
        // (the paginated chain below takes precedence when .offset is called)
        offset: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(selectData),
        }),
        // Direct resolution for findById / count
        then: (resolve: any) => resolve(selectData),
      }),
    }),
  }));

  return {
    select: selectMock,
    insert: vi.fn().mockReturnValue(mutateChain()),
    update: vi.fn().mockReturnValue(mutateChain()),
    delete: vi.fn().mockReturnValue(mutateChain()),
  };
}

describe('GuestService', () => {
  let service: GuestService;
  let mockDb: ReturnType<typeof createMockDb>;

  async function makeService(db: ReturnType<typeof createMockDb>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GuestService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    return module.get<GuestService>(GuestService);
  }

  beforeEach(async () => {
    mockDb = createMockDb();
    service = await makeService(mockDb);
  });

  describe('create', () => {
    it('should create a guest and return it (no property scoping on create)', async () => {
      const result = await service.create({
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
      });

      expect(result).toEqual(mockGuest);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a guest when found and linked to the property', async () => {
      const result = await service.findById(mockGuest.id, PROPERTY_ID);
      expect(result).toEqual(mockGuest);
    });

    it('should throw NotFoundException when guest has no reservation at property', async () => {
      const scopedDb = createMockDb({ reservationLink: [] });
      const svc = await makeService(scopedDb);
      await expect(svc.findById(mockGuest.id, PROPERTY_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when guest row is missing', async () => {
      const emptyDb = createMockDb({ selectData: [] });
      const svc = await makeService(emptyDb);
      await expect(svc.findById('nonexistent', PROPERTY_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update and return the guest when linked to property', async () => {
      const result = await service.update(mockGuest.id, PROPERTY_ID, {
        firstName: 'Jane',
      });
      expect(result).toEqual(mockGuest);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when not linked to property', async () => {
      const scopedDb = createMockDb({ reservationLink: [] });
      const svc = await makeService(scopedDb);
      await expect(
        svc.update(mockGuest.id, PROPERTY_ID, { firstName: 'Jane' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete (GDPR anonymization — Bug 4)', () => {
    it('should anonymize the guest (not hard-delete) when linked to property', async () => {
      // Bug 4: delete now anonymizes via UPDATE + audit-log INSERT. The
      // physical row stays (FK constraints from bookings/reservations).
      const result = await service.delete(mockGuest.id, PROPERTY_ID);
      expect(result).toEqual({ deleted: true });
      // Anonymization is an UPDATE, not a DELETE
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
      // Audit log is inserted
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should scrub PII fields on anonymization', async () => {
      await service.delete(mockGuest.id, PROPERTY_ID);
      const setCall = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
      expect(setCall.firstName).toBe('Deleted');
      expect(setCall.lastName).toBe('User');
      expect(setCall.phone).toBeNull();
      expect(setCall.dateOfBirth).toBeNull();
      expect(setCall.idNumber).toBeNull();
      expect(setCall.nationality).toBeNull();
      expect(setCall.addressLine1).toBeNull();
      expect(setCall.taxId).toBeNull();
      expect(setCall.gender).toBeNull();
      expect(setCall.profession).toBeNull();
      expect(setCall.registrationData).toBeNull();
      expect(setCall.isDeleted).toBe(true);
      expect(setCall.deletedAt).toBeInstanceOf(Date);
      // Email is replaced with a non-identifying sentinel
      expect(setCall.email).toMatch(/^anon\+.+@deleted\.local$/);
    });

    it('should write an audit log with reason=gdpr_erasure and WITHOUT previous PII', async () => {
      await service.delete(mockGuest.id, PROPERTY_ID);
      const auditValues = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(auditValues.action).toBe('delete');
      expect(auditValues.entityType).toBe('guest');
      expect(auditValues.description).toBe('gdpr_erasure');
      // Must NOT leak PII back into the audit log
      expect(auditValues.previousValue).toBeUndefined();
      expect(JSON.stringify(auditValues)).not.toContain('john@example.com');
    });

    it('should throw NotFoundException when not linked to property', async () => {
      const scopedDb = createMockDb({ reservationLink: [] });
      const svc = await makeService(scopedDb);
      await expect(svc.delete(mockGuest.id, PROPERTY_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('preserves booking history by not calling db.delete', async () => {
      // Contract test: FK-safe erasure MUST never issue DELETE on guests.
      await service.delete(mockGuest.id, PROPERTY_ID);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('should return paginated results scoped to property', async () => {
      // search() issues three select() calls:
      //   1. subquery (inArray) — `select({guestId}).from(reservations).where(...)`
      //      — this is NOT awaited directly; drizzle embeds it in SQL. The mock
      //      just needs .from().where() to be chainable without throwing.
      //   2. paginated listing — `.from(guests).where().limit().offset().orderBy()`
      //   3. count — `.from(guests).where()` then awaited via thenable
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // inArray subquery — returns a chainable object (never awaited)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({}),
            }),
          };
        }
        if (callCount === 2) {
          // paginated data query
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockResolvedValue([mockGuest]),
                  }),
                }),
              }),
            }),
          };
        }
        // count query
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([{ count: 1 }]),
            }),
          }),
        };
      });

      const result = await service.search(PROPERTY_ID, { page: 1, limit: 20 });
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page', 1);
      expect(result).toHaveProperty('limit', 20);
    });
  });
});
