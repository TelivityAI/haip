import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { ReportsController } from './reports.controller';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';

describe('ReportsController authorization', () => {
  it('requires the reports.view permission on the controller', () => {
    // Financial/occupancy reports must not be readable by any authenticated user
    // (e.g. housekeeping) — PermissionsGuard enforces this metadata.
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, ReportsController);
    expect(perms).toContain('reports.view');
  });
});
