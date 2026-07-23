import { describe, it, expect, vi } from 'vitest';
import { GroupsController } from './groups.controller';
import { GroupProfileService } from './group-profile.service';
import { AllotmentService } from './allotment.service';
import { RoomingListService } from './rooming-list.service';

describe('GroupsController', () => {
  it('listRoomingList delegates to RoomingListService.listEntries with property scope', async () => {
    const listEntries = vi.fn().mockResolvedValue([{ id: 'entry-1' }]);
    const controller = new GroupsController(
      {} as GroupProfileService,
      {} as AllotmentService,
      { listEntries } as unknown as RoomingListService,
    );

    const result = await controller.listRoomingList('block-001', 'prop-001');
    expect(listEntries).toHaveBeenCalledWith('block-001', 'prop-001');
    expect(result).toEqual([{ id: 'entry-1' }]);
  });

  it('setInventory passes propertyId from the body (not inferred from the block)', async () => {
    const setInventory = vi.fn().mockResolvedValue({ id: 'inv-1' });
    const controller = new GroupsController(
      {} as GroupProfileService,
      { setInventory } as unknown as AllotmentService,
      {} as RoomingListService,
    );

    const dto = {
      propertyId: 'prop-001',
      stayDate: '2026-06-02',
      roomTypeId: 'rt-001',
      roomsAllotted: 5,
    };
    await controller.setInventory('block-001', dto);
    expect(setInventory).toHaveBeenCalledWith('block-001', 'prop-001', dto);
  });
});
