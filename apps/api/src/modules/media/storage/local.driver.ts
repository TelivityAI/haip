import { NotImplementedException } from '@nestjs/common';
import { StorageDriver, PutResult } from './storage.driver';

/**
 * Default driver used when object storage is not configured.
 *
 * Uploads are rejected with a clear, actionable message; the dashboard hides
 * the "Upload file" control and uses URL-paste instead. This keeps the
 * one-command demo free of any object-storage dependency.
 */
export class LocalDriver implements StorageDriver {
  readonly configured = false;

  async put(): Promise<PutResult> {
    throw new NotImplementedException(
      'Object storage is not configured. Paste an image URL instead, or set STORAGE_DRIVER=s3 with the S3_* environment variables.',
    );
  }

  async delete(): Promise<void> {
    // No-op: nothing is ever stored by this driver.
  }
}
