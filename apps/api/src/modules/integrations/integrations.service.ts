import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
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
  if (slug === 'redsys') return sanitizeRedsysConfig(raw);
  if (slug === 'worldline') return sanitizeWorldlineConfig(raw);
  return raw;
}

function sanitizeRedsysConfig(raw: Record<string, unknown>): Record<string, unknown> {
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

const WORLDLINE_API_SECRET_FIELDS = ['secretApiKey', 'secret_api_key'] as const;
const WORLDLINE_WEBHOOK_SECRET_FIELDS = ['webhookSecret', 'webhook_secret'] as const;

function plaintextSecret(
  config: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = config?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function rejectCiphertext(incoming: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    if (Object.hasOwn(incoming, field)) {
      throw new BadRequestException('Credential ciphertext cannot be supplied through integration config');
    }
  }
}

export function mergeWorldlineConfig(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  rejectCiphertext(incoming, ['secretApiKeyEncrypted', 'webhookSecretEncrypted']);
  const merged = { ...existing, ...incoming };
  const apiSecret = plaintextSecret(incoming, WORLDLINE_API_SECRET_FIELDS)
    ?? (!existing?.['secretApiKeyEncrypted'] ? plaintextSecret(existing, WORLDLINE_API_SECRET_FIELDS) : undefined);
  const webhookSecret = plaintextSecret(incoming, WORLDLINE_WEBHOOK_SECRET_FIELDS)
    ?? (!existing?.['webhookSecretEncrypted'] ? plaintextSecret(existing, WORLDLINE_WEBHOOK_SECRET_FIELDS) : undefined);
  for (const key of [...WORLDLINE_API_SECRET_FIELDS, ...WORLDLINE_WEBHOOK_SECRET_FIELDS]) delete merged[key];
  delete merged['secretApiKeyMasked'];
  delete merged['webhookSecretMasked'];
  const ring = loadMigrationCredentialKeyRingFromEnv();
  if (apiSecret) merged['secretApiKeyEncrypted'] = encryptCredentialPlaintext(apiSecret, ring);
  if (webhookSecret) merged['webhookSecretEncrypted'] = encryptCredentialPlaintext(webhookSecret, ring);
  return merged;
}

function sanitizeWorldlineConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const apiConfigured = Boolean(raw['secretApiKeyEncrypted']) || Boolean(plaintextSecret(raw, WORLDLINE_API_SECRET_FIELDS));
  const webhookConfigured = Boolean(raw['webhookSecretEncrypted']) || Boolean(plaintextSecret(raw, WORLDLINE_WEBHOOK_SECRET_FIELDS));
  for (const key of [...WORLDLINE_API_SECRET_FIELDS, ...WORLDLINE_WEBHOOK_SECRET_FIELDS]) delete raw[key];
  delete raw['secretApiKeyEncrypted'];
  delete raw['webhookSecretEncrypted'];
  delete raw['secretApiKeyMasked'];
  delete raw['webhookSecretMasked'];
  if (apiConfigured) raw['secretApiKeyMasked'] = '••••••••';
  if (webhookConfigured) raw['webhookSecretMasked'] = '••••••••';
  return raw;
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

  /** Tenant-scoped migration of plaintext API and webhook secrets. */
  async protectWorldlineCredentials(propertyId: string): Promise<void> {
    const secretFields = [...WORLDLINE_API_SECRET_FIELDS, ...WORLDLINE_WEBHOOK_SECRET_FIELDS];
    await this.db.transaction(async (tx: any) => {
      const [row] = await tx.select().from(propertyIntegrations)
        .where(and(eq(propertyIntegrations.propertyId, propertyId), eq(propertyIntegrations.catalogSlug, 'worldline')))
        .limit(1).for('update');
      if (!row || !secretFields.some((key) => Object.hasOwn(row.config, key))) return;
      const config = mergeWorldlineConfig({}, row.config);
      await tx.update(propertyIntegrations).set({ config, updatedAt: new Date() })
        .where(and(eq(propertyIntegrations.id, row.id), eq(propertyIntegrations.propertyId, propertyId)));
      await tx.insert(auditLogs).values({
        propertyId, entityType: 'property_integration', entityId: row.id,
        action: 'property_integration.credentials_protected',
        newValue: { catalogSlug: 'worldline', protected: Boolean(config['secretApiKeyEncrypted']) },
      });
    });
  }

  async findWorldlineWebhookConfig(keyId: string): Promise<{ propertyId: string; config: Record<string, unknown> } | null> {
    const [row] = await this.db.select({
      propertyId: propertyIntegrations.propertyId,
      config: propertyIntegrations.config,
    }).from(propertyIntegrations)
      .where(and(
        eq(propertyIntegrations.catalogSlug, 'worldline'),
        eq(propertyIntegrations.enabled, true),
        sql`${propertyIntegrations.config}->>'webhookKeyId' = ${keyId}`,
      ))
      .limit(1);
    if (!row) return null;
    return { propertyId: row.propertyId, config: (row.config ?? {}) as Record<string, unknown> };
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
    const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
    const config =
      slug === 'redsys'
        ? mergeRedsysConfig(incoming, existingConfig)
        : slug === 'worldline'
          ? mergeWorldlineConfig(incoming, existingConfig)
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
