import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageDriver, PutOptions, PutResult } from './storage.driver';

export interface S3DriverConfig {
  bucket: string;
  region: string;
  endpoint?: string; // e.g. http://minio:9000 for MinIO; omit for AWS
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean; // true for MinIO
  /**
   * Stable public base URL for objects (e.g. a CDN or a public bucket host).
   * If omitted, a path-style URL is derived from endpoint + bucket. The bucket
   * must allow public read for these URLs to resolve.
   */
  publicBaseUrl?: string;
}

/**
 * S3-compatible object storage driver (AWS S3 / MinIO).
 *
 * Returns a STABLE public URL (not a presigned, expiring one) so stored media
 * URLs remain valid indefinitely — the bucket is expected to allow public read,
 * or a CDN `publicBaseUrl` is configured in front of it.
 */
export class S3Driver implements StorageDriver {
  readonly configured = true;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3DriverConfig) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  async put(buffer: Buffer, opts: PutOptions): Promise<PutResult> {
    const safeName = (opts.filename ?? 'image')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-100);
    const storageKey = `properties/${opts.propertyId}/media/${randomUUID()}-${safeName}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: opts.contentType,
      }),
    );

    return { storageKey, url: this.resolveUrl(storageKey) };
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: storageKey }),
    );
  }

  private resolveUrl(storageKey: string): string {
    if (this.cfg.publicBaseUrl) {
      return `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${storageKey}`;
    }
    const base = (this.cfg.endpoint ?? `https://s3.${this.cfg.region}.amazonaws.com`).replace(/\/$/, '');
    // Path-style: <endpoint>/<bucket>/<key> (works for MinIO and S3 path-style).
    return `${base}/${this.cfg.bucket}/${storageKey}`;
  }
}
