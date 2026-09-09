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


export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export function sanitizeIntegrationConfig(
  slug: string,
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const raw = { ...(config ?? {}) };
  if (slug !== 'redsys') return raw;
  const secret = raw['secretKey'];
  delete raw['secretKey'];
  if (typeof secret === 'string' && secret.trim()) {
    raw['secretKeyMasked'] = maskSecret(secret);
  }
  return raw;
}

export function mergeRedsysConfig(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged = { ...incoming };
  const nextSecret = merged['secretKey'];
  if (typeof nextSecret !== 'string' || !nextSecret.trim()) {
    const prev = existing?.['secretKey'];
    if (typeof prev === 'string' && prev.trim()) {
      merged['secretKey'] = prev;
    } else {
      delete merged['secretKey'];
    }
  }
  // Never persist UI-only masked values.
  delete merged['secretKeyMasked'];
  return merged;
}

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

    const bySlug = new Map<string, any>(connections.map((row: any) => [row.catalogSlug, row]));

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

    const [existing] = await this.db
      .select({
        id: propertyIntegrations.id,
        config: propertyIntegrations.config,
      })
      .from(propertyIntegrations)
      .where(
        and(
          eq(propertyIntegrations.propertyId, propertyId),
          eq(propertyIntegrations.catalogSlug, slug),
        ),
      )
      .limit(1);

    const incoming = (dto.config ?? {}) as Record<string, unknown>;
    const config =
      slug === 'redsys'
        ? mergeRedsysConfig(incoming, (existing?.config ?? {}) as Record<string, unknown>)
        : incoming;

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
