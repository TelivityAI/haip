import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { and, eq, asc } from 'drizzle-orm';
import {
  media,
  properties,
  roomTypes,
  rooms,
  auditLogs,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { StorageService } from './storage/storage.service';
import { CreateMediaDto } from './dto/create-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { ReorderMediaDto } from './dto/reorder-media.dto';

type OwnerType = 'property' | 'room_type' | 'room';

/**
 * MediaService — images for properties, room types, and rooms.
 *
 * Multi-tenancy: every method is scoped by `propertyId`. The polymorphic
 * `ownerId` has no FK, so `assertOwnerAtProperty` verifies the owner exists at
 * the requesting property before any write — preventing a confused-deputy where
 * a caller attaches media to another tenant's entity.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly storage: StorageService,
    @Optional() private readonly webhook?: WebhookService,
  ) {}

  /** Whether the upload pipeline is available (drives the dashboard UI). */
  getConfig() {
    return { uploadEnabled: this.storage.configured };
  }

  /**
   * Notify channel content sync that an owner's images changed (fire-and-forget).
   * A photo edit IS a room-type/property content change.
   */
  private async emitContentChanged(ownerType: OwnerType, propertyId: string) {
    const event = ownerType === 'property' ? 'property.content_updated' : 'roomtype.content_updated';
    await this.webhook?.emit(event, ownerType, propertyId, { propertyId }, propertyId);
  }

  private async assertOwnerAtProperty(
    ownerType: OwnerType,
    ownerId: string,
    propertyId: string,
  ): Promise<void> {
    let exists: unknown[];
    if (ownerType === 'property') {
      // A property owns its own media — ownerId must be the property itself.
      if (ownerId !== propertyId) {
        throw new BadRequestException(
          'For ownerType "property", ownerId must equal propertyId',
        );
      }
      exists = await this.db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);
    } else if (ownerType === 'room_type') {
      exists = await this.db
        .select({ id: roomTypes.id })
        .from(roomTypes)
        .where(and(eq(roomTypes.id, ownerId), eq(roomTypes.propertyId, propertyId)))
        .limit(1);
    } else {
      exists = await this.db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, ownerId), eq(rooms.propertyId, propertyId)))
        .limit(1);
    }
    if (!exists.length) {
      throw new NotFoundException(
        `${ownerType} ${ownerId} not found at this property`,
      );
    }
  }

  async findByOwner(propertyId: string, ownerType: OwnerType, ownerId: string) {
    return this.db
      .select()
      .from(media)
      .where(
        and(
          eq(media.propertyId, propertyId),
          eq(media.ownerType, ownerType),
          eq(media.ownerId, ownerId),
        ),
      )
      .orderBy(asc(media.sortOrder), asc(media.createdAt));
  }

  private async getOwned(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.propertyId, propertyId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Media ${id} not found`);
    }
    return row;
  }

  private async clearPrimary(
    tx: any,
    ownerType: OwnerType,
    ownerId: string,
    propertyId: string,
  ): Promise<void> {
    await tx
      .update(media)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(media.propertyId, propertyId),
          eq(media.ownerType, ownerType),
          eq(media.ownerId, ownerId),
          eq(media.isPrimary, true),
        ),
      );
  }

  async create(dto: CreateMediaDto) {
    await this.assertOwnerAtProperty(dto.ownerType, dto.ownerId, dto.propertyId);
    const row = await this.insertMedia({
      propertyId: dto.propertyId,
      ownerType: dto.ownerType,
      ownerId: dto.ownerId,
      url: dto.url,
      category: dto.category,
      caption: dto.caption,
      altText: dto.altText,
      sortOrder: dto.sortOrder,
      isPrimary: dto.isPrimary ?? false,
    });
    await this.emitContentChanged(dto.ownerType, dto.propertyId);
    return row;
  }

  /**
   * Shared insert used by create() and uploadAndCreate(). When isPrimary is
   * requested, clears any existing primary in the same transaction to honor the
   * one-primary-per-owner unique index.
   */
  private async insertMedia(values: {
    propertyId: string;
    ownerType: OwnerType;
    ownerId: string;
    url: string;
    category?: string;
    caption?: string;
    altText?: string;
    sortOrder?: number;
    isPrimary: boolean;
    storageKey?: string;
    width?: number;
    height?: number;
    contentType?: string;
    fileSize?: number;
  }) {
    const insertRow = async (tx: any) => {
      if (values.isPrimary) {
        await this.clearPrimary(
          tx,
          values.ownerType,
          values.ownerId,
          values.propertyId,
        );
      }
      const [row] = await tx.insert(media).values(values).returning();
      await tx.insert(auditLogs).values({
        propertyId: values.propertyId,
        action: 'create',
        entityType: 'media',
        entityId: row.id,
        description: `media.created:${values.ownerType}`,
      });
      return row;
    };
    return this.db.transaction(insertRow);
  }

  async update(id: string, propertyId: string, dto: UpdateMediaDto) {
    const existing = await this.getOwned(id, propertyId);
    const result = await this.db.transaction(async (tx: any) => {
      if (dto.isPrimary === true) {
        await this.clearPrimary(
          tx,
          existing.ownerType,
          existing.ownerId,
          propertyId,
        );
      }
      const [row] = await tx
        .update(media)
        .set({ ...dto, updatedAt: new Date() })
        .where(and(eq(media.id, id), eq(media.propertyId, propertyId)))
        .returning();
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'media',
        entityId: id,
        description: 'media.updated',
      });
      return row;
    });
    await this.emitContentChanged(existing.ownerType, propertyId);
    return result;
  }

  async delete(id: string, propertyId: string) {
    const existing = await this.getOwned(id, propertyId);
    if (existing.storageKey) {
      // Best-effort: a storage failure must not block removing the DB row.
      try {
        await this.storage.delete(existing.storageKey);
      } catch {
        // swallow — orphaned object can be reaped separately
      }
    }
    await this.db
      .delete(media)
      .where(and(eq(media.id, id), eq(media.propertyId, propertyId)));
    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'delete',
      entityType: 'media',
      entityId: id,
      description: 'media.deleted',
    });
    await this.emitContentChanged(existing.ownerType, propertyId);
    return { deleted: true };
  }

  async setPrimary(id: string, propertyId: string) {
    const existing = await this.getOwned(id, propertyId);
    const result = await this.db.transaction(async (tx: any) => {
      await this.clearPrimary(
        tx,
        existing.ownerType,
        existing.ownerId,
        propertyId,
      );
      const [row] = await tx
        .update(media)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(and(eq(media.id, id), eq(media.propertyId, propertyId)))
        .returning();
      return row;
    });
    await this.emitContentChanged(existing.ownerType, propertyId);
    return result;
  }

  async reorder(dto: ReorderMediaDto) {
    await this.assertOwnerAtProperty(dto.ownerType, dto.ownerId, dto.propertyId);
    const result = await this.db.transaction(async (tx: any) => {
      for (const [i, mediaId] of dto.orderedIds.entries()) {
        await tx
          .update(media)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(media.id, mediaId),
              eq(media.propertyId, dto.propertyId),
              eq(media.ownerType, dto.ownerType),
              eq(media.ownerId, dto.ownerId),
            ),
          );
      }
      return this.findByOwner(dto.propertyId, dto.ownerType, dto.ownerId);
    });
    await this.emitContentChanged(dto.ownerType, dto.propertyId);
    return result;
  }

  async uploadAndCreate(
    dto: {
      propertyId: string;
      ownerType: OwnerType;
      ownerId: string;
      category?: string;
      caption?: string;
      altText?: string;
    },
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded (field "file")');
    }
    // Verify the bytes actually are a JPEG/PNG/WebP — a forged Content-Type must
    // not let an attacker store HTML/SVG that later executes from the CDN origin.
    const detected = sniffImageType(file.buffer);
    if (!detected) {
      throw new BadRequestException('File is not a valid JPEG, PNG, or WebP image');
    }
    await this.assertOwnerAtProperty(dto.ownerType, dto.ownerId, dto.propertyId);
    const { storageKey, url } = await this.storage.put(file.buffer, {
      propertyId: dto.propertyId,
      contentType: detected, // store the sniffed type, not the client-supplied one
      filename: file.originalname,
    });
    const row = await this.insertMedia({
      propertyId: dto.propertyId,
      ownerType: dto.ownerType,
      ownerId: dto.ownerId,
      url,
      storageKey,
      category: dto.category,
      caption: dto.caption,
      altText: dto.altText,
      contentType: detected,
      fileSize: file.size,
      isPrimary: false,
    });
    await this.emitContentChanged(dto.ownerType, dto.propertyId);
    return row;
  }
}

/**
 * Identify an image by magic bytes (not the client-declared MIME). Returns the
 * canonical content type for JPEG/PNG/WebP, or null if the bytes don't match —
 * dependency-free so no risk of a forged Content-Type smuggling HTML/SVG.
 */
function sniffImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
