import { Injectable, Inject, Optional, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { properties, media } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
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

  async update(id: string, dto: UpdatePropertyDto) {
    const [property] = await this.db
      .update(properties)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(properties.id, id))
      .returning();
    if (!property) {
      throw new NotFoundException(`Property ${id} not found`);
    }
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
