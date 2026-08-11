import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { migrationLegacyIdMap } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import type { MigrationEntity } from './dto/create-migration-job.dto';

/**
 * Legacy identity map — resolves source-PMS ids to HAIP uuids per project and
 * makes re-runs idempotent: already-mapped legacy ids are skipped, never
 * re-created. Every query is scoped by propertyId + projectRef (both come from
 * the request/job, never derived from other entity lookups).
 */
@Injectable()
export class MigrationIdMapService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /** Bulk-load existing mappings for one entity into memory for a job run. */
  async loadForEntity(
    propertyId: string,
    projectRef: string,
    entity: MigrationEntity,
  ): Promise<Map<string, string>> {
    const rows = await this.db
      .select({
        legacyId: migrationLegacyIdMap.legacyId,
        haipId: migrationLegacyIdMap.haipId,
      })
      .from(migrationLegacyIdMap)
      .where(
        and(
          eq(migrationLegacyIdMap.propertyId, propertyId),
          eq(migrationLegacyIdMap.projectRef, projectRef),
          eq(migrationLegacyIdMap.entity, entity),
        ),
      );
    return new Map(rows.map((r: { legacyId: string; haipId: string }) => [r.legacyId, r.haipId]));
  }

  /** Record one mapping. On conflict (concurrent/retry double-insert) the existing row wins. */
  async record(
    propertyId: string,
    projectRef: string,
    entity: MigrationEntity,
    legacyId: string,
    haipId: string,
  ): Promise<void> {
    await this.db
      .insert(migrationLegacyIdMap)
      .values({ propertyId, projectRef, entity, legacyId, haipId })
      .onConflictDoNothing({
        target: [
          migrationLegacyIdMap.propertyId,
          migrationLegacyIdMap.projectRef,
          migrationLegacyIdMap.entity,
          migrationLegacyIdMap.legacyId,
        ],
      });
  }

  /** Resolve a legacy id to a HAIP uuid. */
  async resolve(
    propertyId: string,
    projectRef: string,
    entity: MigrationEntity,
    legacyId: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ haipId: migrationLegacyIdMap.haipId })
      .from(migrationLegacyIdMap)
      .where(
        and(
          eq(migrationLegacyIdMap.propertyId, propertyId),
          eq(migrationLegacyIdMap.projectRef, projectRef),
          eq(migrationLegacyIdMap.entity, entity),
          eq(migrationLegacyIdMap.legacyId, legacyId),
        ),
      );
    return row?.haipId;
  }
}
