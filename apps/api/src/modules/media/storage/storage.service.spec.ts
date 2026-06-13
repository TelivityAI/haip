import { describe, it, expect, beforeEach } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { LocalDriver } from './local.driver';

function configWith(values: Record<string, string | undefined>) {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as any;
}

describe('LocalDriver', () => {
  it('is not configured and rejects uploads with an actionable message', async () => {
    const driver = new LocalDriver();
    expect(driver.configured).toBe(false);
    await expect(driver.put()).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('delete is a no-op', async () => {
    await expect(new LocalDriver().delete()).resolves.toBeUndefined();
  });
});

describe('StorageService driver selection', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService(configWith({}));
  });

  it('defaults to LocalDriver (uploads disabled) when STORAGE_DRIVER is unset', async () => {
    await service.onModuleInit();
    expect(service.configured).toBe(false);
    await expect(
      service.put(Buffer.from('x'), { propertyId: 'p1' }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('stays on LocalDriver when STORAGE_DRIVER=s3 but S3 vars are missing', async () => {
    service = new StorageService(configWith({ STORAGE_DRIVER: 's3' }));
    await service.onModuleInit();
    expect(service.configured).toBe(false);
  });
});
