import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { MigrationController } from './migration.controller';

describe('MigrationController authorization', () => {
  it('requires settings.manage on job routes', () => {
    const createJobPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.createJob,
    );
    const getJobPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.getJob,
    );
    const resumeJobPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.resumeJob,
    );

    expect(createJobPerms).toEqual(['settings.manage']);
    expect(getJobPerms).toEqual(['settings.manage']);
    expect(resumeJobPerms).toEqual(['settings.manage']);
  });

  it('requires settings.manage on credential routes', () => {
    const listPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.listCredentials,
    );
    const upsertPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.upsertCredentials,
    );
    const deletePerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.deleteCredential,
    );
    const deleteAllPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MigrationController.prototype.deleteAllCredentials,
    );

    expect(listPerms).toEqual(['settings.manage']);
    expect(upsertPerms).toEqual(['settings.manage']);
    expect(deletePerms).toEqual(['settings.manage']);
    expect(deleteAllPerms).toEqual(['settings.manage']);
  });
});
