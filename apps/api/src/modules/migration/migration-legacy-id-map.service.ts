import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { migrationLegacyIdMap } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class MigrationLegacyIdMapService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async lookup(
    propertyId: string,
    projectId: string,
    entity: string,
    legacyId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ haipId: migrationLegacyIdMap.haipId })
      .from(migrationLegacyIdMap)
      .where(
        and(
          eq(migrationLegacyIdMap.propertyId, propertyId),
          eq(migrationLegacyIdMap.projectId, projectId),
          eq(migrationLegacyIdMap.entity, entity),
          eq(migrationLegacyIdMap.legacyId, legacyId),
        ),
      );
    return row?.haipId ?? null;
  }

  async record(
    propertyId: string,
    projectId: string,
    entity: string,
    legacyId: string,
    haipId: string,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .insert(migrationLegacyIdMap)
      .values({ propertyId, projectId, entity, legacyId, haipId })
      .onConflictDoNothing({
        target: [
          migrationLegacyIdMap.propertyId,
          migrationLegacyIdMap.projectId,
          migrationLegacyIdMap.entity,
          migrationLegacyIdMap.legacyId,
        ],
      });
  }
}
