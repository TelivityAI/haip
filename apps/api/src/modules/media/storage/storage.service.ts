import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageDriver, PutOptions, PutResult } from './storage.driver';
import { LocalDriver } from './local.driver';

/**
 * Selects and delegates to a storage driver based on env configuration.
 *
 * STORAGE_DRIVER=s3 (with S3_* vars) → S3Driver (lazily imported).
 * Otherwise → LocalDriver writing under LOCAL_STORAGE_PATH / ./data/uploads
 * so guest ID photos and media uploads work without object storage.
 */
@Injectable()
export class StorageService implements OnModuleInit, StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  private driver: StorageDriver = new LocalDriver();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const localRoot =
      this.config.get<string>('LOCAL_STORAGE_PATH') || process.env['LOCAL_STORAGE_PATH'];
    this.driver = new LocalDriver(localRoot || undefined);

    if (this.config.get<string>('STORAGE_DRIVER') !== 's3') {
      this.logger.log(`Object storage: local filesystem (${localRoot || './data/uploads'}).`);
      return;
    }
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'STORAGE_DRIVER=s3 but S3 credentials missing — using local filesystem.',
      );
      return;
    }
    const { S3Driver } = await import('./s3.driver');
    this.driver = new S3Driver({
      bucket,
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      endpoint: this.config.get<string>('S3_ENDPOINT') || undefined,
      accessKeyId,
      secretAccessKey,
      forcePathStyle:
        this.config.get<string>('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      publicBaseUrl: this.config.get<string>('S3_PUBLIC_BASE_URL') || undefined,
    });
    this.logger.log(`Object storage enabled (bucket: ${bucket}).`);
  }

  get configured(): boolean {
    return this.driver.configured;
  }

  put(buffer: Buffer, opts: PutOptions): Promise<PutResult> {
    return this.driver.put(buffer, opts);
  }

  delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }

  /** Read object bytes when the active driver supports it (local always; S3 optional). */
  async get(storageKey: string): Promise<Buffer | null> {
    if (this.driver instanceof LocalDriver) {
      return this.driver.get(storageKey);
    }
    const maybeGet = (this.driver as StorageDriver & { get?: (k: string) => Promise<Buffer | null> })
      .get;
    if (typeof maybeGet === 'function') {
      return maybeGet.call(this.driver, storageKey);
    }
    return null;
  }

  /** Absolute path for local driver keys (staff preview). */
  localAbsolutePath(storageKey: string): string | null {
    if (this.driver instanceof LocalDriver) {
      return this.driver.absolutePath(storageKey);
    }
    return null;
  }
}
