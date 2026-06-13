/**
 * Storage driver abstraction for media uploads.
 *
 * Two implementations exist:
 *  - LocalDriver  (default): object storage is NOT configured — uploads are
 *    rejected and the UI falls back to "paste an image URL". Keeps the demo
 *    lean with zero extra infrastructure.
 *  - S3Driver: S3-compatible object storage (AWS S3 / MinIO), selected by
 *    STORAGE_DRIVER=s3. Lazily imported so the AWS SDK never loads in the
 *    default demo path.
 */
export interface PutOptions {
  propertyId: string;
  contentType?: string;
  filename?: string;
}

export interface PutResult {
  storageKey: string;
  url: string;
}

export interface StorageDriver {
  /** Whether uploads are supported in the current configuration. */
  readonly configured: boolean;
  put(buffer: Buffer, opts: PutOptions): Promise<PutResult>;
  delete(storageKey: string): Promise<void>;
}
