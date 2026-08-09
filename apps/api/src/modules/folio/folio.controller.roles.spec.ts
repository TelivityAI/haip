import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { FolioController } from './folio.controller';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ROLE_DEFAULT_PERMISSIONS } from '../auth/permissions.catalog';

describe('FolioController role gates', () => {
  const reflector = new Reflector();

  const folioReadRoles = Object.entries(ROLE_DEFAULT_PERMISSIONS)
    .filter(([, perms]) => perms.includes('folios.read'))
    .map(([role]) => role);

  it('listFolios requires every role that has folios.read (except readonly)', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, FolioController.prototype.listFolios);
    expect(roles).toBeDefined();
    for (const role of folioReadRoles) {
      if (role === 'readonly') continue;
      expect(roles, `missing ${role}`).toContain(role);
    }
  });

  it('listFolios denies revenue_manager (no folios.read)', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, FolioController.prototype.listFolios);
    expect(roles).not.toContain('revenue_manager');
    expect(ROLE_DEFAULT_PERMISSIONS.revenue_manager).not.toContain('folios.read');
  });
});
