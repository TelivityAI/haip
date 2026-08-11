import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { auditLogs, migrationSourceCredentials } from '@telivityhaip/database';
import type { MigrationSourcePms } from '@telivityhaip/shared';
import {
  CredentialEncryptionError,
  decryptCredentialPlaintext,
  deserializeEncryptedBlob,
  encryptCredentialPlaintext,
  loadMigrationCredentialKeyRingFromEnv,
  serializeEncryptedBlob,
} from '../../common/crypto/credential-encryption';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';

export interface MigrationCredentialMetadata {
  id: string;
  propertyId: string;
  sourcePms: string;
  encryptionKeyId: string;
  createdAt: Date;
  rotatedAt: Date | null;
  updatedAt: Date;
}

/** Redacted audit payload — never includes credential values or ciphertext. */
function auditMetadata(row: {
  id: string;
  propertyId: string;
  sourcePms: string;
  encryptionKeyId: string;
  createdAt: Date;
  rotatedAt: Date | null;
  updatedAt: Date;
}): MigrationCredentialMetadata {
  return {
    id: row.id,
    propertyId: row.propertyId,
    sourcePms: row.sourcePms,
    encryptionKeyId: row.encryptionKeyId,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * Server-side vault for encrypted source-PMS migration credentials.
 * Decrypted values are for the migration runner only — never exposed via HTTP.
 */
@Injectable()
export class MigrationSourceCredentialsService {
  private readonly logger = new Logger(MigrationSourceCredentialsService.name);

  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  private keyRing() {
    return loadMigrationCredentialKeyRingFromEnv();
  }

  async listMetadata(propertyId: string): Promise<MigrationCredentialMetadata[]> {
    const rows = await this.db
      .select({
        id: migrationSourceCredentials.id,
        propertyId: migrationSourceCredentials.propertyId,
        sourcePms: migrationSourceCredentials.sourcePms,
        encryptionKeyId: migrationSourceCredentials.encryptionKeyId,
        createdAt: migrationSourceCredentials.createdAt,
        rotatedAt: migrationSourceCredentials.rotatedAt,
        updatedAt: migrationSourceCredentials.updatedAt,
      })
      .from(migrationSourceCredentials)
      .where(eq(migrationSourceCredentials.propertyId, propertyId))
      .orderBy(desc(migrationSourceCredentials.createdAt));

    return rows.map((row: MigrationCredentialMetadata) => auditMetadata(row));
  }

  async upsert(
    propertyId: string,
    sourcePms: MigrationSourcePms,
    credentials: Record<string, unknown>,
    actor?: AuditActor,
  ): Promise<MigrationCredentialMetadata> {
    let blob;
    try {
      blob = encryptCredentialPlaintext(JSON.stringify(credentials), this.keyRing());
    } catch (err) {
      if (err instanceof CredentialEncryptionError) {
        throw new InternalServerErrorException(err.message);
      }
      throw err;
    }

    const serialized = serializeEncryptedBlob(blob);
    const now = new Date();
    const [existing] = await this.db
      .select({ id: migrationSourceCredentials.id })
      .from(migrationSourceCredentials)
      .where(
        and(
          eq(migrationSourceCredentials.propertyId, propertyId),
          eq(migrationSourceCredentials.sourcePms, sourcePms),
        ),
      )
      .limit(1);

    let row: {
      id: string;
      propertyId: string;
      sourcePms: string;
      encryptionKeyId: string;
      createdAt: Date;
      rotatedAt: Date | null;
      updatedAt: Date;
    };

    if (existing) {
      [row] = await this.db
        .update(migrationSourceCredentials)
        .set({
          ciphertext: serialized,
          encryptionKeyId: blob.keyId,
          rotatedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(migrationSourceCredentials.id, existing.id),
            eq(migrationSourceCredentials.propertyId, propertyId),
          ),
        )
        .returning({
          id: migrationSourceCredentials.id,
          propertyId: migrationSourceCredentials.propertyId,
          sourcePms: migrationSourceCredentials.sourcePms,
          encryptionKeyId: migrationSourceCredentials.encryptionKeyId,
          createdAt: migrationSourceCredentials.createdAt,
          rotatedAt: migrationSourceCredentials.rotatedAt,
          updatedAt: migrationSourceCredentials.updatedAt,
        });
      await this.writeAudit('update', propertyId, row.id, 'migration_credential.rotated', row, actor);
    } else {
      [row] = await this.db
        .insert(migrationSourceCredentials)
        .values({
          propertyId,
          sourcePms,
          ciphertext: serialized,
          encryptionKeyId: blob.keyId,
        })
        .returning({
          id: migrationSourceCredentials.id,
          propertyId: migrationSourceCredentials.propertyId,
          sourcePms: migrationSourceCredentials.sourcePms,
          encryptionKeyId: migrationSourceCredentials.encryptionKeyId,
          createdAt: migrationSourceCredentials.createdAt,
          rotatedAt: migrationSourceCredentials.rotatedAt,
          updatedAt: migrationSourceCredentials.updatedAt,
        });
      await this.writeAudit('create', propertyId, row.id, 'migration_credential.created', row, actor);
    }

    return auditMetadata(row);
  }

  /**
   * Decrypt credentials for the migration runner. Must never be called from a
   * controller response path.
   */
  async decryptForRunner(
    propertyId: string,
    sourcePms: MigrationSourcePms,
  ): Promise<Record<string, unknown>> {
    const [row] = await this.db
      .select({
        ciphertext: migrationSourceCredentials.ciphertext,
        sourcePms: migrationSourceCredentials.sourcePms,
      })
      .from(migrationSourceCredentials)
      .where(
        and(
          eq(migrationSourceCredentials.propertyId, propertyId),
          eq(migrationSourceCredentials.sourcePms, sourcePms),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException(
        `Migration credentials for source PMS "${sourcePms}" not found`,
      );
    }

    try {
      const blob = deserializeEncryptedBlob(row.ciphertext);
      const plaintext = decryptCredentialPlaintext(blob, this.keyRing());
      const parsed: unknown = JSON.parse(plaintext);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CredentialEncryptionError('Stored credentials are not a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt migration credentials for property=${propertyId} sourcePms=${sourcePms}`,
      );
      if (err instanceof CredentialEncryptionError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * Delete stored credentials — invoked on migration project completion or GDPR erasure.
   * When sourcePms is omitted, all credentials for the property are removed.
   */
  async delete(
    propertyId: string,
    sourcePms?: MigrationSourcePms,
    actor?: AuditActor,
  ): Promise<{ deleted: number }> {
    const conditions = [eq(migrationSourceCredentials.propertyId, propertyId)];
    if (sourcePms) {
      conditions.push(eq(migrationSourceCredentials.sourcePms, sourcePms));
    }

    const rows = await this.db
      .select({
        id: migrationSourceCredentials.id,
        propertyId: migrationSourceCredentials.propertyId,
        sourcePms: migrationSourceCredentials.sourcePms,
        encryptionKeyId: migrationSourceCredentials.encryptionKeyId,
        createdAt: migrationSourceCredentials.createdAt,
        rotatedAt: migrationSourceCredentials.rotatedAt,
        updatedAt: migrationSourceCredentials.updatedAt,
      })
      .from(migrationSourceCredentials)
      .where(and(...conditions));

    if (rows.length === 0) {
      if (sourcePms) {
        throw new NotFoundException(
          `Migration credentials for source PMS "${sourcePms}" not found`,
        );
      }
      return { deleted: 0 };
    }

    await this.db
      .delete(migrationSourceCredentials)
      .where(and(...conditions));

    for (const row of rows) {
      await this.writeAudit(
        'delete',
        propertyId,
        row.id,
        sourcePms ? 'migration_credential.erased' : 'migration_credential.erased_all',
        row,
        actor,
      );
    }

    return { deleted: rows.length };
  }

  private async writeAudit(
    action: 'create' | 'update' | 'delete',
    propertyId: string,
    entityId: string,
    description: string,
    row: {
      id: string;
      propertyId: string;
      sourcePms: string;
      encryptionKeyId: string;
      createdAt: Date;
      rotatedAt: Date | null;
      updatedAt: Date;
    },
    actor?: AuditActor,
  ) {
    await this.db.insert(auditLogs).values({
      propertyId,
      action,
      entityType: 'migration_source_credential',
      entityId,
      description,
      newValue: auditMetadata(row),
      ...actorFields(actor),
    });
  }
}
