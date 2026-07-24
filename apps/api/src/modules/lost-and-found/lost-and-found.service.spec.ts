import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LostAndFoundService } from './lost-and-found.service';
import { DRIZZLE } from '../../database/database.module';

const mockItem = {
  id: 'lnf-001',
  propertyId: 'prop-001',
  roomId: 'room-001',
  reservationId: null,
  guestId: null,
  description: 'Blue umbrella',
  tagCode: 'LNF-ABC',
  status: 'held',
  foundAt: new Date('2026-07-23T10:00:00Z'),
  disposeAfter: new Date('2026-10-21T10:00:00Z'),
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mutateResolving(returnData: any[]) {
  return () => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnData),
      }),
    }),
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
  });
}

function selectResolving(returnData: any[]) {
  return () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(returnData),
        then: (resolve: (v: unknown) => void) => resolve(returnData),
      }),
      orderBy: vi.fn().mockResolvedValue(returnData),
    }),
  });
}

describe('LostAndFoundService', () => {
  let service: LostAndFoundService;
  let db: any;

  beforeEach(async () => {
    db = {
      insert: vi.fn().mockImplementation(mutateResolving([mockItem])),
      select: vi.fn().mockImplementation(selectResolving([{ id: 'room-001' }])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LostAndFoundService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get(LostAndFoundService);
  });

  it('creates item scoped to propertyId with 90-day disposeAfter', async () => {
    const result = await service.create({
      propertyId: 'prop-001',
      roomId: 'room-001',
      description: 'Blue umbrella',
    });

    expect(result.propertyId).toBe('prop-001');
    expect(db.insert).toHaveBeenCalled();
    const values = db.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(values.propertyId).toBe('prop-001');
    expect(values.tagCode).toMatch(/^LNF-/);

    const foundAt = values.foundAt as Date;
    const disposeAfter = values.disposeAfter as Date;
    const diffDays = Math.round((disposeAfter.getTime() - foundAt.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(90);
  });

  it('rejects room from another property', async () => {
    db.select.mockImplementation(selectResolving([]));

    await expect(
      service.create({
        propertyId: 'prop-001',
        roomId: 'room-other',
        description: 'Item',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
