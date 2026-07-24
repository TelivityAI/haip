import { Test, TestingModule } from '@nestjs/testing';
import { RoomDiscrepancyService } from './room-discrepancy.service';
import { DRIZZLE } from '../../database/database.module';

describe('RoomDiscrepancyService', () => {
  let service: RoomDiscrepancyService;
  let db: any;

  const propertyRooms = [
    { id: 'room-101', number: '101', status: 'occupied', hkOccupancy: 'unknown', hkObservedPersons: null },
    { id: 'room-102', number: '102', status: 'vacant_clean', hkOccupancy: 'unknown', hkObservedPersons: null },
    { id: 'room-103', number: '103', status: 'vacant_dirty', hkOccupancy: 'unknown', hkObservedPersons: null },
    { id: 'room-104', number: '104', status: 'guest_ready', hkOccupancy: 'unknown', hkObservedPersons: null },
  ];

  const inHouseReservations = [
    { id: 'res-102', roomId: 'room-102', status: 'checked_in', adults: 2, children: 0 },
    { id: 'res-104', roomId: 'room-104', status: 'stayover', adults: 1, children: 0 },
  ];

  beforeEach(async () => {
    let selectCall = 0;
    db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCall += 1;
            // 1=rooms, 2=reservations, 3=open cases
            if (selectCall === 1) return Promise.resolve(propertyRooms);
            if (selectCall === 2) return Promise.resolve(inHouseReservations);
            return Promise.resolve([]);
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'room-101', hkOccupancy: 'vacant' }]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'case-1', status: 'open' }]),
        }),
      }),
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

  it('maps skip alias for occupied_without_reservation', async () => {
    const result = await service.getDiscrepancies('prop-001', '2026-07-23');
    const occupied = result.discrepancies.find((d) => d.kind === 'occupied_without_reservation');
    expect(occupied?.alias).toBe('skip');
  });

  it('sets HK observation on a room', async () => {
    const updated = await service.setHkObservation('room-101', 'prop-001', { occupancy: 'vacant' });
    expect(updated.hkOccupancy).toBe('vacant');
    expect(db.update).toHaveBeenCalled();
  });
});
