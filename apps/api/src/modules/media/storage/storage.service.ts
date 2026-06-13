import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageDriver, PutOptions, PutResult } from './storage.driver';
import { LocalDriver } from './local.driver';

/**
 * Selects and delegates to a storage driver based on env configuration.
 *
 * STORAGE_DRIVER=s3 (with S3_* vars) → S3Driver (lazily imported so the AWS SDK
 * never loads in the default demo). Anything else → LocalDriver (uploads
 * disabled; URL-paste only).
 */
@Injectable()
export class StorageService implements OnModuleInit, StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  private driver: StorageDriver = new LocalDriver();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('STORAGE_DRIVER') !== 's3') {
      return;
    }
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'STORAGE_DRIVER=s3 but S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing — uploads disabled.',
      );
      return;
    }
    // Lazy import keeps @aws-sdk/client-s3 out of the default demo runtime.
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
}
