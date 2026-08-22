import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { FolioController } from './folio.controller';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ROLE_DEFAULT_PERMISSIONS } from '../auth/permissions.catalog';

const reflector = new Reflector();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function permsOf(target: Function) {
  return reflector.get<string[] | undefined>(PERMISSIONS_KEY, target);
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function rolesOf(target: Function) {
  return reflector.get<string[] | undefined>(ROLES_KEY, target);
}

describe('FolioController permission gates', () => {
  const folioReadRoles = Object.entries(ROLE_DEFAULT_PERMISSIONS)
    .filter(([, perms]) => perms.includes('folios.read'))
    .map(([role]) => role);

  const folioManageRoles = Object.entries(ROLE_DEFAULT_PERMISSIONS)
    .filter(([, perms]) => perms.includes('folios.manage'))
    .map(([role]) => role);

  it.each([
    [FolioController.prototype.listFolios, 'folios.read'],
    [FolioController.prototype.getFolioById, 'folios.read'],
    [FolioController.prototype.getCharges, 'folios.read'],
    [FolioController.prototype.listRoutingRules, 'folios.read'],
    [FolioController.prototype.listFiscalDocuments, 'folios.read'],
  ])('%s requires folios.read', (method, expectedKey) => {
    expect(rolesOf(method)).toBeUndefined();
    expect(permsOf(method)).toEqual([expectedKey]);
  });

  it.each([
    [FolioController.prototype.createRoutingRule, 'folios.manage'],
    [FolioController.prototype.createFolio, 'folios.manage'],
    [FolioController.prototype.updateFolio, 'folios.manage'],
    [FolioController.prototype.settleFolio, 'folios.manage'],
    [FolioController.prototype.closeFolio, 'folios.manage'],
    [FolioController.prototype.postCharge, 'folios.manage'],
    [FolioController.prototype.reverseCharge, 'folios.manage'],
    [FolioController.prototype.lockCharges, 'folios.manage'],
    [FolioController.prototype.transferCharge, 'folios.manage'],
    [FolioController.prototype.moveTransactions, 'folios.manage'],
    [FolioController.prototype.requestFiscalDocument, 'folios.manage'],
    [FolioController.prototype.issueFiscalDocument, 'folios.manage'],
    [FolioController.prototype.voidFiscalDocument, 'folios.manage'],
    [FolioController.prototype.transferToCityLedger, 'folios.manage'],
  ])('%s requires folios.manage', (method, expectedKey) => {
    expect(rolesOf(method)).toBeUndefined();
    expect(permsOf(method)).toEqual([expectedKey]);
  });

  it('every role with folios.read in the catalog can reach read routes, including readonly', () => {
    expect(folioReadRoles).toContain('readonly');
    for (const role of folioReadRoles) {
      expect(ROLE_DEFAULT_PERMISSIONS[role]).toContain('folios.read');
    }
  });

  it('folios.manage grantees are front_desk and accounting (not reservations or night_auditor)', () => {
    expect(folioManageRoles).toContain('front_desk');
    expect(folioManageRoles).toContain('accounting');
    expect(folioManageRoles).not.toContain('reservations');
    expect(folioManageRoles).not.toContain('night_auditor');
    expect(ROLE_DEFAULT_PERMISSIONS['reservations']).not.toContain('folios.manage');
    expect(ROLE_DEFAULT_PERMISSIONS['night_auditor']).not.toContain('folios.manage');
  });

  it('listFolios denies revenue_manager (no folios.read)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS['revenue_manager']).not.toContain('folios.read');
  });
});
