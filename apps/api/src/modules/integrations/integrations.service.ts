import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  auditLogs,
  integrationCatalogEntries,
  propertyIntegrations,
} from '@telivityhaip/database';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';
import { ListIntegrationsDto, UpsertPropertyIntegrationDto } from './dto/integration-registry.dto';

@Injectable()
export class IntegrationsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async listCatalog(filters: ListIntegrationsDto = {}) {
    const conditions: any[] = [];
    if (filters.category) {
      conditions.push(eq(integrationCatalogEntries.category, filters.category));
    }
    if (filters.status) {
      conditions.push(eq(integrationCatalogEntries.status, filters.status));
    }

    const query = this.db.select().from(integrationCatalogEntries);
    const scoped = conditions.length > 0 ? query.where(and(...conditions)) : query;

    return scoped.orderBy(
      asc(integrationCatalogEntries.category),
      asc(integrationCatalogEntries.name),
    );
  }

  async findCatalogBySlug(slug: string) {
    const [item] = await this.db
      .select()
      .from(integrationCatalogEntries)
      .where(eq(integrationCatalogEntries.slug, slug))
      .limit(1);

    if (!item) {
      throw new NotFoundException(`Integration ${slug} not found`);
    }

    return item;
  }

  async listPropertyIntegrations(propertyId: string) {
    const catalog = await this.listCatalog();
    const connections = await this.db
      .select()
      .from(propertyIntegrations)
      .where(eq(propertyIntegrations.propertyId, propertyId));

    const bySlug = new Map(connections.map((row: any) => [row.catalogSlug, row]));

    return catalog.map((entry: any) => {
      const connection = bySlug.get(entry.slug);
      return {
        ...entry,
        enabled: connection?.enabled ?? false,
        config: connection?.config ?? {},
        connectionId: connection?.id ?? null,
      };
    });
  }

  async upsertPropertyIntegration(
    propertyId: string,
    slug: string,
    dto: UpsertPropertyIntegrationDto,
    actor?: AuditActor,
  ) {
    await this.findCatalogBySlug(slug);

    const config = dto.config ?? {};
    const [existing] = await this.db
      .select({ id: propertyIntegrations.id })
      .from(propertyIntegrations)
      .where(
        and(
          eq(propertyIntegrations.propertyId, propertyId),
          eq(propertyIntegrations.catalogSlug, slug),
        ),
      )
      .limit(1);

    let row: any;
    if (existing) {
      [row] = await this.db
        .update(propertyIntegrations)
        .set({
          enabled: dto.enabled,
          config,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(propertyIntegrations.id, existing.id),
            eq(propertyIntegrations.propertyId, propertyId),
          ),
        )
        .returning();
    } else {
      [row] = await this.db
        .insert(propertyIntegrations)
        .values({
          propertyId,
          catalogSlug: slug,
          enabled: dto.enabled,
          config,
        })
        .returning();
    }

    await this.db.insert(auditLogs).values({
      propertyId,
      entityType: 'property_integration',
      entityId: row.id,
      action: existing ? 'property_integration.updated' : 'property_integration.created',
      payload: { catalogSlug: slug, enabled: dto.enabled },
      ...actorFields(actor),
    });

    const catalog = await this.findCatalogBySlug(slug);
    return {
      ...catalog,
      enabled: row.enabled,
      config: row.config ?? {},
      connectionId: row.id,
    };
  }

  async getPropertyIntegration(propertyId: string, slug: string) {
    await this.findCatalogBySlug(slug);

    const [connection] = await this.db
      .select()
      .from(propertyIntegrations)
      .where(
        and(
          eq(propertyIntegrations.propertyId, propertyId),
          eq(propertyIntegrations.catalogSlug, slug),
        ),
      )
      .limit(1);

    const catalog = await this.findCatalogBySlug(slug);
    return {
      ...catalog,
      enabled: connection?.enabled ?? false,
      config: connection?.config ?? {},
      connectionId: connection?.id ?? null,
    };
  }
}
