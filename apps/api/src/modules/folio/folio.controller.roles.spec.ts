import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { FolioController } from './folio.controller';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { ROLE_DEFAULT_PERMISSIONS } from '../auth/permissions.catalog';

describe('FolioController permission gates', () => {
  const reflector = new Reflector();

  const folioReadRoles = Object.entries(ROLE_DEFAULT_PERMISSIONS)
    .filter(([, perms]) => perms.includes('folios.read'))
    .map(([role]) => role);

  it('listFolios requires folios.read', () => {
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, FolioController.prototype.listFolios);
    expect(perms).toEqual(['folios.read']);
  });

  // A local-permission gate, not a Keycloak realm-role list, so every role
  // the catalog grants folios.read to reaches this route -- readonly
  // included. Any property-scoped custom role granted folios.read has no
  // Keycloak realm role and could never have satisfied the old @Roles() list.
  it('every role with folios.read in the catalog can reach listFolios, including readonly', () => {
    expect(folioReadRoles).toContain('readonly');
    for (const role of folioReadRoles) {
      expect(ROLE_DEFAULT_PERMISSIONS[role]).toContain('folios.read');
    }
  });

  it('listFolios denies revenue_manager (no folios.read)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS['revenue_manager']).not.toContain('folios.read');
  });
});
