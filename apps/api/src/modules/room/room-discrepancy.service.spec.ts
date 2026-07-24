import { Test, TestingModule } from '@nestjs/testing';
import { RoomDiscrepancyService } from './room-discrepancy.service';
import { DRIZZLE } from '../../database/database.module';

describe('RoomDiscrepancyService', () => {
  let service: RoomDiscrepancyService;
  let db: any;

  const propertyRooms = [
    { id: 'room-101', number: '101', status: 'occupied' },
    { id: 'room-102', number: '102', status: 'vacant_clean' },
    { id: 'room-103', number: '103', status: 'vacant_dirty' },
    { id: 'room-104', number: '104', status: 'guest_ready' },
  ];

  const inHouseReservations = [
    { id: 'res-102', roomId: 'room-102', status: 'checked_in' },
    { id: 'res-104', roomId: 'room-104', status: 'stayover' },
  ];

  beforeEach(async () => {
    let selectCall = 0;
    db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCall += 1;
            return Promise.resolve(selectCall === 1 ? propertyRooms : inHouseReservations);
          }),
        }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoomDiscrepancyService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get(RoomDiscrepancyService);
  });

  it('detects occupied room without in-house reservation', async () => {
    const result = await service.getDiscrepancies('prop-001', '2026-07-23');

    const occupied = result.discrepancies.find((d) => d.kind === 'occupied_without_reservation');
    expect(occupied).toBeDefined();
    expect(occupied?.roomNumber).toBe('101');
  });

  it('detects vacant room with in-house reservation', async () => {
    const result = await service.getDiscrepancies('prop-001', '2026-07-23');

    const vacant = result.discrepancies.filter(
      (d) => d.kind === 'vacant_with_in_house_reservation',
    );
    expect(vacant.length).toBe(1);
    expect(vacant[0].roomNumber).toBe('102');
    expect(vacant[0].reservationStatus).toBe('checked_in');
  });

  it('does not flag guest_ready with in-house reservation as vacant discrepancy', async () => {
    const result = await service.getDiscrepancies('prop-001', '2026-07-23');

    const room104 = result.discrepancies.filter((d) => d.roomNumber === '104');
    expect(room104).toHaveLength(0);
  });
});
