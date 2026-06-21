import { Injectable, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { contentSyncLogs, properties, roomTypes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { ChannelService } from './channel.service';
import { MediaService } from '../media/media.service';
import type { WebhookPayload } from '../webhook/webhook.service';
import type {
  ContentPushParams,
  ContentMediaItem,
  ChannelSyncResult,
} from './channel-adapter.interface';

/**
 * ContentSyncService — pushes descriptive content (photos, descriptions,
 * amenities) to channels. Mirrors AriService but for the content API.
 *
 * Content is assembled from the property/room-type records plus the media
 * table (Phase 1). Triggered manually (POST /channels/push/content) or by
 * content-changed events (property/media edits), fire-and-forget.
 */
@Injectable()
export class ContentSyncService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly channelService: ChannelService,
    private readonly mediaService: MediaService,
  ) {}

  async pushContent(propertyId: string, channelConnectionId?: string) {
    const connections = channelConnectionId
      ? [await this.channelService.findById(channelConnectionId, propertyId)]
      : await this.channelService.getActiveConnections(propertyId);

    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (!property) return [];

    const propertyImages = (
      await this.mediaService.findByOwner(propertyId, 'property', propertyId)
    ).map(toContentMedia);

    const results: Array<{ channelConnectionId: string; result: ChannelSyncResult }> = [];

    for (const conn of connections) {
      const roomTypeMapping = (conn.roomTypeMapping ?? []) as Array<{
        roomTypeId: string;
        channelRoomCode: string;
      }>;
      if (roomTypeMapping.length === 0) continue;

      const rtParams: ContentPushParams['roomTypes'] = [];
      for (const mapping of roomTypeMapping) {
        // Scope the room type to the property — a mapping pointing at another
        // tenant's room type (or a deleted one) is skipped.
        const [rt] = await this.db
          .select()
          .from(roomTypes)
          .where(and(eq(roomTypes.id, mapping.roomTypeId), eq(roomTypes.propertyId, propertyId)));
        if (!rt) continue;

        const images = (
          await this.mediaService.findByOwner(propertyId, 'room_type', rt.id)
        ).map(toContentMedia);

        rtParams.push({
          channelRoomCode: mapping.channelRoomCode,
          name: rt.name,
          description: rt.description,
          maxOccupancy: rt.maxOccupancy,
          bedType: rt.bedType,
          amenities: rt.amenities ?? [],
          images,
        });
      }

      const params: ContentPushParams = {
        propertyId,
        channelConnectionId: conn.id,
        connectionConfig: (conn.config ?? {}) as Record<string, unknown>,
        property: {
          name: property.name,
          description: property.description,
          address: property.addressLine1,
          city: property.city,
          countryCode: property.countryCode,
          starRating: property.starRating,
          amenities: [],
          images: propertyImages,
        },
        roomTypes: rtParams,
      };

      const adapter = this.adapterFactory.getAdapter(conn.adapterType);
      const result = await adapter.pushContent(params);

      await this.logSync(propertyId, conn.id, params, result);
      await this.channelService.updateSyncStatus(
        conn.id,
        conn.propertyId,
        result.success ? 'success' : 'failed',
        result.errors.length > 0 ? result.errors[0]!.message : undefined,
      );

      results.push({ channelConnectionId: conn.id, result });
    }

    return results;
  }

  async getContentSyncLogs(channelConnectionId: string, propertyId: string, limit = 50) {
    return this.db
      .select()
      .from(contentSyncLogs)
      .where(
        and(
          eq(contentSyncLogs.channelConnectionId, channelConnectionId),
          eq(contentSyncLogs.propertyId, propertyId),
        ),
      )
      .orderBy(contentSyncLogs.createdAt)
      .limit(limit);
  }

  // --- Event-driven content push (fire-and-forget) ---

  @OnEvent('property.content_updated')
  @OnEvent('roomtype.content_updated')
  async handleContentUpdated(payload: WebhookPayload) {
    if (!payload.propertyId) return;
    try {
      await this.pushContent(payload.propertyId);
    } catch {
      // Fire-and-forget: a push failure must not crash the originating request.
    }
  }

  private async logSync(
    propertyId: string,
    channelConnectionId: string,
    payload: unknown,
    result: ChannelSyncResult,
  ) {
    await this.db.insert(contentSyncLogs).values({
      propertyId,
      channelConnectionId,
      direction: 'push' as any,
      action: 'content_push',
      payload,
      response: result,
      status: result.success ? 'success' : 'failed',
      errorMessage: result.errors.length > 0 ? result.errors.map((e) => e.message).join('; ') : null,
    });
  }
}

function toContentMedia(m: {
  url: string;
  category: string;
  caption: string | null;
  isPrimary: boolean;
  sortOrder: number;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
}): ContentMediaItem {
  return {
    url: m.url,
    category: m.category,
    caption: m.caption,
    isPrimary: m.isPrimary,
    sortOrder: m.sortOrder,
    contentType: m.contentType ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
    fileSize: m.fileSize ?? null,
  };
}
