import { Injectable, Inject, Optional, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { properties } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

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
    return property;
  }

  async findAll() {
    return this.db.select().from(properties).where(eq(properties.isActive, true));
  }

  async findById(id: string) {
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, id));
    if (!property) {
      throw new NotFoundException(`Property ${id} not found`);
    }
    return property;
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
    // Content (name/description/amenities) may have changed — notify channel
    // content sync (fire-and-forget; listener pushes to OTAs).
    await this.webhookService?.emit(
      'property.content_updated',
      'property',
      id,
      { propertyId: id },
      id,
    );
    return property;
  }
}
