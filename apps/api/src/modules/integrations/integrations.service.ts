import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  auditLogs,
  integrationCatalogEntries,
  propertyIntegrations,
} from '@telivityhaip/database';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';
import { ListIntegrationsDto, UpsertPropertyIntegrationDto } from './dto/integration-registry.dto';
import { encryptCredentialPlaintext, loadMigrationCredentialKeyRingFromEnv } from '../../common/crypto/credential-encryption';


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
  const configured = Boolean(raw['secretKeyEncrypted']) || Boolean(redsysSecret(raw));
  for (const key of REDSYS_SECRET_FIELDS) delete raw[key];
  delete raw['secretKeyEncrypted'];
  delete raw['secretKeyMasked'];
  if (configured) raw['secretKeyMasked'] = '••••••••';
  return raw;
}

const REDSYS_SECRET_FIELDS = ['secretKey', 'secret_key', 'clave'] as const;

function redsysSecret(config: Record<string, unknown>): string | undefined {
  for (const field of REDSYS_SECRET_FIELDS) {
    const value = config[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function mergeRedsysConfig(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (Object.hasOwn(incoming, 'secretKeyEncrypted')) {
    throw new BadRequestException('Credential ciphertext cannot be supplied through integration config');
  }
  const merged = { ...existing, ...incoming };
  const secret = redsysSecret(incoming) ?? (!existing?.['secretKeyEncrypted'] ? redsysSecret(existing ?? {}) : undefined);
  for (const key of REDSYS_SECRET_FIELDS) delete merged[key];
  // Never persist UI-only masked values.
  delete merged['secretKeyMasked'];
  if (secret) merged['secretKeyEncrypted'] = encryptCredentialPlaintext(secret, loadMigrationCredentialKeyRingFromEnv());
  return merged;
}

@Injectable()
export class IntegrationsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /** Tenant-scoped, idempotent data migration; ciphertext uses the existing key ring. */
  async protectRedsysCredentials(propertyId: string): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const [row] = await tx.select().from(propertyIntegrations)
        .where(and(eq(propertyIntegrations.propertyId, propertyId), eq(propertyIntegrations.catalogSlug, 'redsys')))
        .limit(1).for('update');
      if (!row || !REDSYS_SECRET_FIELDS.some((key) => Object.hasOwn(row.config, key))) return;
      const config = mergeRedsysConfig({}, row.config);
      await tx.update(propertyIntegrations).set({ config, updatedAt: new Date() })
        .where(and(eq(propertyIntegrations.id, row.id), eq(propertyIntegrations.propertyId, propertyId)));
      await tx.insert(auditLogs).values({
        propertyId, entityType: 'property_integration', entityId: row.id,
        action: 'property_integration.credentials_protected',
        newValue: { catalogSlug: 'redsys', protected: Boolean(config['secretKeyEncrypted']) },
      });
    });
  }

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
