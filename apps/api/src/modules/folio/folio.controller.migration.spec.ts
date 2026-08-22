import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/roles.decorator';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { FolioController } from './folio.controller';

const reflector = new Reflector();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function rolesOf(target: Function) {
  return reflector.get<string[] | undefined>(ROLES_KEY, target);
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function permsOf(target: Function) {
  return reflector.get<string[] | undefined>(PERMISSIONS_KEY, target);
}

describe('FolioController @Roles() migration (follow-up to #338)', () => {
  const controllerMethods = Object.getOwnPropertyNames(FolioController.prototype).filter(
    (name) => name !== 'constructor',
  );

  it('no FolioController route still carries @Roles()', () => {
    for (const name of controllerMethods) {
      const method = FolioController.prototype[name as keyof FolioController];
      if (typeof method !== 'function') continue;
      expect(rolesOf(method), `${name} still has @Roles()`).toBeUndefined();
    }
  });

  it('every FolioController route carries @RequirePermissions', () => {
    for (const name of controllerMethods) {
      const method = FolioController.prototype[name as keyof FolioController];
      if (typeof method !== 'function') continue;
      expect(permsOf(method), `${name} missing @RequirePermissions`).toBeDefined();
    }
  });
});
