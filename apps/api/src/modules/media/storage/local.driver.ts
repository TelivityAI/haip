import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { StorageDriver, PutOptions, PutResult } from './storage.driver';

/**
 * Filesystem storage when S3 is not configured.
 * Root: LOCAL_STORAGE_PATH or ./data/uploads.
 */
export class LocalDriver implements StorageDriver {
  private readonly logger = new Logger(LocalDriver.name);
  readonly configured = true;
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = resolve(rootDir || process.env['LOCAL_STORAGE_PATH'] || './data/uploads');
  }

  async put(buffer: Buffer, opts: PutOptions): Promise<PutResult> {
    const safeName = (opts.filename || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '_');
    const propertySegment = (opts.propertyId || 'unknown').replace(/[^a-zA-Z0-9-]/g, '');
    const storageKey = `${propertySegment}/${Date.now()}-${safeName}`;
    const fullPath = join(this.root, storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);
    this.logger.debug(`Stored ${storageKey} (${buffer.length} bytes)`);
    return {
      storageKey,
      url: `local://${storageKey}`,
    };
  }

  async delete(storageKey: string): Promise<void> {
    const fullPath = join(this.root, storageKey);
    try {
      await unlink(fullPath);
    } catch {
      // ignore missing
    }
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.root, storageKey));
    } catch {
      return null;
    }
  }

  absolutePath(storageKey: string): string {
    return join(this.root, storageKey);
  }
}
