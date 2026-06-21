import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { channelConnections, ratePlans, roomTypes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { CreateChannelConnectionDto } from './dto/create-channel-connection.dto';
import { UpdateChannelConnectionDto } from './dto/update-channel-connection.dto';

@Injectable()
export class ChannelService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly adapterFactory: ChannelAdapterFactory,
  ) {}

  async create(dto: CreateChannelConnectionDto) {
    // Validate adapter type exists
    this.adapterFactory.getAdapter(dto.adapterType);

    // FK ownership (security audit follow-on): the mapping JSON references PMS
    // ratePlan / roomType ids. A misconfigured (or maliciously edited) mapping
    // pointing at a foreign-tenant id would later cause cross-tenant reservation
    // writes on inbound OTA pushes (inbound-reservation.service has its own
    // read-time guard, but write-time validation is defense in depth).
    await this.assertMappingOwnership(dto.propertyId, dto.ratePlanMapping, dto.roomTypeMapping);

    const [connection] = await this.db
      .insert(channelConnections)
      .values({
        propertyId: dto.propertyId,
        channelCode: dto.channelCode,
        channelName: dto.channelName,
        adapterType: dto.adapterType,
        syncDirection: (dto.syncDirection ?? 'bidirectional') as any,
        config: dto.config ?? {},
        ratePlanMapping: dto.ratePlanMapping ?? [],
        roomTypeMapping: dto.roomTypeMapping ?? [],
        status: 'pending_setup',
      })
      .returning();

    await this.webhookService.emit(
      'channel.connected',
      'channel_connection',
      connection.id,
      { channelCode: dto.channelCode, adapterType: dto.adapterType },
      dto.propertyId,
    );

    return connection;
  }

  async findById(id: string, propertyId: string) {
    const [connection] = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(eq(channelConnections.id, id), eq(channelConnections.propertyId, propertyId)),
      );
    if (!connection) {
      throw new NotFoundException(`Channel connection ${id} not found`);
    }
    return connection;
  }

  async list(propertyId: string) {
    return this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.propertyId, propertyId),
          eq(channelConnections.isActive, true),
        ),
      );
  }

  async getActiveConnections(propertyId: string) {
    return this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.propertyId, propertyId),
          eq(channelConnections.status, 'active' as any),
          eq(channelConnections.isActive, true),
        ),
      );
  }

  async update(id: string, propertyId: string, dto: UpdateChannelConnectionDto) {
    await this.findById(id, propertyId);

    // FK ownership (security audit follow-on): same rationale as create() —
    // an update could otherwise swap the mapping to reference a foreign tenant's
    // rate plans / room types.
    if (dto.ratePlanMapping !== undefined || dto.roomTypeMapping !== undefined) {
      await this.assertMappingOwnership(propertyId, dto.ratePlanMapping, dto.roomTypeMapping);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.channelName !== undefined) updates['channelName'] = dto.channelName;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.syncDirection !== undefined) updates['syncDirection'] = dto.syncDirection;
    if (dto.config !== undefined) updates['config'] = dto.config;
    if (dto.ratePlanMapping !== undefined) updates['ratePlanMapping'] = dto.ratePlanMapping;
    if (dto.roomTypeMapping !== undefined) updates['roomTypeMapping'] = dto.roomTypeMapping;

    const [updated] = await this.db
      .update(channelConnections)
      .set(updates)
      .where(
        and(eq(channelConnections.id, id), eq(channelConnections.propertyId, propertyId)),
      )
      .returning();

    return updated;
  }

  async deactivate(id: string, propertyId: string) {
    const connection = await this.findById(id, propertyId);

    const [updated] = await this.db
      .update(channelConnections)
      .set({ isActive: false, status: 'inactive', updatedAt: new Date() })
      .where(
        and(eq(channelConnections.id, id), eq(channelConnections.propertyId, propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'channel.disconnected',
      'channel_connection',
      id,
      { channelCode: connection.channelCode },
      propertyId,
    );

    return updated;
  }

  async testConnection(id: string, propertyId: string) {
    const connection = await this.findById(id, propertyId);
    const adapter = this.adapterFactory.getAdapter(connection.adapterType);
    return adapter.testConnection(connection.config ?? {});
  }

  async findByAdapterType(adapterType: string) {
    return this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.adapterType, adapterType),
          eq(channelConnections.isActive, true),
        ),
      );
  }

  async updateSyncStatus(
    id: string,
    propertyId: string,
    status: string,
    error?: string,
  ) {
    // propertyId is part of the WHERE (not just the caller's responsibility): every
    // property-scoped write must filter by propertyId so this stays safe even if a
    // future caller passes a client-supplied connection id.
    await this.db
      .update(channelConnections)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncError: error ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(channelConnections.id, id), eq(channelConnections.propertyId, propertyId)));
  }

  /**
   * Verify every ratePlanId in `ratePlanMapping` and every roomTypeId in
   * `roomTypeMapping` belongs to `propertyId`. Closes the cross-tenant mapping
   * write path flagged in the security re-audit — the inbound-reservation
   * service already does this on the read side; this is defense in depth so the
   * row never lands in the DB in the first place.
   */
  private async assertMappingOwnership(
    propertyId: string,
    ratePlanMapping: Array<{ ratePlanId: string }> | undefined,
    roomTypeMapping: Array<{ roomTypeId: string }> | undefined,
  ): Promise<void> {
    const rpIds = (ratePlanMapping ?? []).map((m) => m.ratePlanId).filter(Boolean);
    const rtIds = (roomTypeMapping ?? []).map((m) => m.roomTypeId).filter(Boolean);

    if (rpIds.length) {
      const rows = await this.db
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(and(inArray(ratePlans.id, rpIds), eq(ratePlans.propertyId, propertyId)));
      const found = new Set(rows.map((r: any) => r.id));
      const foreign = rpIds.filter((id) => !found.has(id));
      if (foreign.length) {
        throw new BadRequestException(`rate plan(s) ${foreign.join(', ')} not found in this property`);
      }
    }

    if (rtIds.length) {
      const rows = await this.db
        .select({ id: roomTypes.id })
        .from(roomTypes)
        .where(and(inArray(roomTypes.id, rtIds), eq(roomTypes.propertyId, propertyId)));
      const found = new Set(rows.map((r: any) => r.id));
      const foreign = rtIds.filter((id) => !found.has(id));
      if (foreign.length) {
        throw new BadRequestException(`room type(s) ${foreign.join(', ')} not found in this property`);
      }
    }
  }
}
