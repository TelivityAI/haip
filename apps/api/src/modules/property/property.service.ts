import { Injectable, Inject, Optional, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { properties, media, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { WebhookService } from '../webhook/webhook.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

type PropertyRow = Record<string, unknown> & {
  id: string;
  staffLogoMediaId?: string | null;
};

@Injectable()
export class PropertyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Optional() private readonly webhookService?: WebhookService,
  ) {}

  async create(dto: CreatePropertyDto) {
    const [property] = await this.db
      .insert(properties)
      .values(dto)
      .returning();
    return this.withLogoUrl(property as PropertyRow);
  }

  async findAll(): Promise<(PropertyRow & { staffLogoUrl: string | null })[]> {
    const rows = (await this.db
      .select()
      .from(properties)
      .where(eq(properties.isActive, true))) as PropertyRow[];
    return this.attachLogoUrls(rows);
  }

  async findById(id: string) {
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, id));
    if (!property) {
      throw new NotFoundException(`Property ${id} not found`);
    }
    return this.withLogoUrl(property as PropertyRow);
  }

  /**
   * Patch a property. `settings` is MERGED, not replaced: it is a bag of independent
   * feature settings (kpiThresholds, operational fees, onlineCheckIn, …) and assigning
   * the column wholesale silently deletes every key the caller did not resend.
   */
  async update(id: string, dto: UpdatePropertyDto, actor?: AuditActor) {
    const existing = (await this.findById(id)) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...dto, updatedAt: new Date() };
    if (dto.settings !== undefined) {
      const current =
        existing['settings'] && typeof existing['settings'] === 'object'
          ? (existing['settings'] as Record<string, unknown>)
          : {};
      const incoming =
        dto.settings && typeof dto.settings === 'object'
          ? (dto.settings as Record<string, unknown>)
          : {};
      patch['settings'] = { ...current, ...incoming };
    }

    const [property] = await this.db
      .update(properties)
      .set(patch)
      .where(eq(properties.id, id))
      .returning();
    if (!property) {
      throw new NotFoundException(`Property ${id} not found`);
    }

    // Settings edits are the audit trail "who changed the check-in time / tax rate" needs;
    // record only the keys the caller actually sent so the row stays readable.
    await this.db.insert(auditLogs).values({
      propertyId: id,
      action: 'update',
      entityType: 'property',
      entityId: id,
      description: 'property.updated',
      previousValue: { settings: existing['settings'] ?? null },
      newValue: { settings: (patch['settings'] as unknown) ?? existing['settings'] ?? null, fields: Object.keys(dto) },
      ...actorFields(actor),
    });

    await this.webhookService?.emit(
      'property.content_updated',
      'property',
      id,
      { propertyId: id },
      id,
    );
    return this.withLogoUrl(property as PropertyRow);
  }

  private async withLogoUrl(property: PropertyRow) {
    const [enriched] = await this.attachLogoUrls([property]);
    return enriched!;
  }

  private async attachLogoUrls(rows: PropertyRow[]) {
    const logoIds = rows
      .map((r) => r['staffLogoMediaId'] as string | null | undefined)
      .filter((id): id is string => !!id);
    if (!logoIds.length) {
      return rows.map((r) => ({ ...r, staffLogoUrl: null as string | null }));
    }
    const mediaRows = await this.db
      .select({ id: media.id, url: media.url })
      .from(media)
      .where(inArray(media.id, logoIds));
    const urlById = new Map<string, string>(
      mediaRows.map((m: { id: string; url: string }) => [m.id, m.url]),
    );
    return rows.map((r) => {
      const logoId = r['staffLogoMediaId'] as string | null | undefined;
      const url: string | null = logoId ? (urlById.get(logoId) ?? null) : null;
      return {
        ...r,
        staffLogoUrl: url,
      };
    });
  }
}
