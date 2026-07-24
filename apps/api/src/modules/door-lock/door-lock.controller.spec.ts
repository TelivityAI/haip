import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { DoorLockController } from './door-lock.controller';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';

describe('DoorLockController authorization', () => {
  it('requires frontdesk.access on list and get endpoints', () => {
    const listPerms = Reflect.getMetadata(PERMISSIONS_KEY, DoorLockController.prototype.list);
    const getPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      DoorLockController.prototype.getByReservation,
    );
    const reissuePerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      DoorLockController.prototype.reissue,
    );

    expect(listPerms).toContain('frontdesk.access');
    expect(getPerms).toContain('frontdesk.access');
    expect(reissuePerms).toContain('frontdesk.access');
  });
});
