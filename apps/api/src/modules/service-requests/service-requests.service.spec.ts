import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { DRIZZLE } from '../../database/database.module';

const mockRequest = {
  id: 'sr-001',
  propertyId: 'prop-001',
  roomId: 'room-001',
  reservationId: null,
  type: 'maintenance',
  priority: 1,
  status: 'open',
  title: 'Leaky faucet',
  description: 'Bathroom sink',
  linkedTaskId: null,
  requestedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mutateResolving(returnData: any[]) {
  return () => ({
    values: vi.fn().mockReturnValue({
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
    }),
  });
}

const mockHousekeepingService = { create: vi.fn() };

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;
  let db: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = {
      insert: vi.fn().mockImplementation(mutateResolving([mockRequest])),
      select: vi.fn().mockImplementation(selectResolving([{ id: 'room-001' }])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestsService,
        { provide: DRIZZLE, useValue: db },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
      ],
    }).compile();

    service = module.get(ServiceRequestsService);
  });

  it('creates service request scoped to propertyId', async () => {
    const result = await service.create({
      propertyId: 'prop-001',
      roomId: 'room-001',
      type: 'maintenance',
      title: 'Leaky faucet',
      description: 'Bathroom sink',
      priority: 1,
    });

    expect(result.propertyId).toBe('prop-001');
    expect(db.insert).toHaveBeenCalled();
    const values = db.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(values.propertyId).toBe('prop-001');
    expect(values.status).toBe('open');
  });

  it('rejects room from another property', async () => {
    db.select.mockImplementation(selectResolving([]));

    await expect(
      service.create({
        propertyId: 'prop-001',
        roomId: 'room-other',
        type: 'service_request',
        title: 'Help',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
