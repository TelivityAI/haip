import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';
import { LocalDriver } from './local.driver';

function configWith(values: Record<string, string | undefined>) {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as any;
}

describe('LocalDriver', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'haip-upload-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores files on disk and returns a storage key', async () => {
    const driver = new LocalDriver(root);
    expect(driver.configured).toBe(true);
    const result = await driver.put(Buffer.from('id-photo'), {
      propertyId: 'prop-1',
      filename: 'passport.jpg',
      contentType: 'image/jpeg',
    });
    expect(result.storageKey).toMatch(/^prop-1\//);
    const raw = await readFile(driver.absolutePath(result.storageKey));
    expect(raw.toString()).toBe('id-photo');
  });

  it('delete removes the file', async () => {
    const driver = new LocalDriver(root);
    const result = await driver.put(Buffer.from('x'), { propertyId: 'p' });
    await driver.delete(result.storageKey);
    await expect(readFile(driver.absolutePath(result.storageKey))).rejects.toThrow();
  });
});

describe('StorageService driver selection', () => {
  it('defaults to LocalDriver (uploads enabled on filesystem)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haip-upload-'));
    try {
      const service = new StorageService(configWith({ LOCAL_STORAGE_PATH: root }));
      await service.onModuleInit();
      expect(service.configured).toBe(true);
      const put = await service.put(Buffer.from('x'), { propertyId: 'p1', filename: 'a.bin' });
      expect(put.storageKey).toContain('p1/');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stays on LocalDriver when STORAGE_DRIVER=s3 but S3 vars are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haip-upload-'));
    try {
      const service = new StorageService(
        configWith({ STORAGE_DRIVER: 's3', LOCAL_STORAGE_PATH: root }),
      );
      await service.onModuleInit();
      expect(service.configured).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
