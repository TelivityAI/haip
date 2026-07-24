import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, lt, notInArray } from 'drizzle-orm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  auditLogs,
  icalBlocks,
  icalFeeds,
  reservations,
  roomTypes,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { assertSafeOutboundUrl, UnsafeUrlError } from '../../common/security/url-guard';
import {
  CreateIcalFeedDto,
  ListIcalBlocksDto,
  ListIcalFeedsDto,
  UpdateIcalFeedDto,
} from './dto/ical.dto';
import {
  buildIcsCalendar,
  mergeBusyBlocks,
  parseIcsBusyBlocks,
  type IcalBusyBlock,
} from './ical.util';

const IMPORT_TIMEOUT_MS = 15_000;

type IcalFeedRow = typeof icalFeeds.$inferSelect;

interface ExportTokenPayload {
  kind: 'ical-export';
  feedId: string;
  propertyId: string;
  roomTypeId: string;
  nonce: string;
}

@Injectable()
export class IcalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateIcalFeedDto) {
    await this.assertRoomTypeAtProperty(dto.roomTypeId, dto.propertyId);
    if (dto.direction === 'import' && !dto.sourceUrl) {
      throw new BadRequestException('sourceUrl is required for import feeds');
    }
    if (dto.direction === 'export' && dto.sourceUrl) {
      throw new BadRequestException('sourceUrl is only valid for import feeds');
    }

    const result = await this.db.transaction(async (tx: any) => {
      const [feed] = await tx
        .insert(icalFeeds)
        .values({
          propertyId: dto.propertyId,
          roomTypeId: dto.roomTypeId,
          direction: dto.direction,
          name: dto.name,
          sourceUrl: dto.direction === 'import' ? dto.sourceUrl : null,
        })
        .returning();

      let exportUrl: string | undefined;
      if (dto.direction === 'export') {
        const token = this.signExportToken(feed);
        exportUrl = this.exportUrlForToken(token);
        const [updated] = await tx
          .update(icalFeeds)
          .set({ tokenHash: hashToken(token), updatedAt: new Date() })
          .where(and(eq(icalFeeds.id, feed.id), eq(icalFeeds.propertyId, dto.propertyId)))
          .returning();
        Object.assign(feed, updated);
      }

      await tx.insert(auditLogs).values({
        propertyId: dto.propertyId,
        action: 'create',
        entityType: 'ical_feed',
        entityId: feed.id,
        newValue: this.auditFeedValue(feed),
        description: `ical_feed.created:${dto.direction}`,
      });

      return { feed: this.publicFeed(feed), exportUrl };
    });

    return result;
  }

  async list(dto: ListIcalFeedsDto) {
    const conditions = [eq(icalFeeds.propertyId, dto.propertyId)];
    if (dto.roomTypeId) conditions.push(eq(icalFeeds.roomTypeId, dto.roomTypeId));
    if (dto.direction) conditions.push(eq(icalFeeds.direction, dto.direction));

    const rows = await this.db
      .select()
      .from(icalFeeds)
      .where(and(...conditions))
      .orderBy(desc(icalFeeds.createdAt));

    return rows.map((row: IcalFeedRow) => this.publicFeed(row));
  }

  async findById(id: string, propertyId: string) {
    return this.publicFeed(await this.findByIdRaw(id, propertyId));
  }

  async update(id: string, propertyId: string, dto: UpdateIcalFeedDto) {
    const existing = await this.findByIdRaw(id, propertyId);
    if (existing.direction === 'export' && dto.sourceUrl) {
      throw new BadRequestException('sourceUrl is only valid for import feeds');
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch['name'] = dto.name;
    if (dto.isActive !== undefined) patch['isActive'] = dto.isActive;
    if (dto.sourceUrl !== undefined) patch['sourceUrl'] = dto.sourceUrl;

    const [updated] = await this.db
      .update(icalFeeds)
      .set(patch)
      .where(and(eq(icalFeeds.id, id), eq(icalFeeds.propertyId, propertyId)))
      .returning();
    if (!updated) throw new NotFoundException(`iCal feed ${id} not found`);

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'ical_feed',
      entityId: id,
      previousValue: this.auditFeedValue(existing),
      newValue: this.auditFeedValue(updated),
      description: 'ical_feed.updated',
    });

    return this.publicFeed(updated);
  }

  async delete(id: string, propertyId: string) {
    const existing = await this.findByIdRaw(id, propertyId);

    await this.db.transaction(async (tx: any) => {
      await tx
        .delete(icalBlocks)
        .where(and(eq(icalBlocks.feedId, id), eq(icalBlocks.propertyId, propertyId)));
      await tx
        .delete(icalFeeds)
        .where(and(eq(icalFeeds.id, id), eq(icalFeeds.propertyId, propertyId)));
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'delete',
        entityType: 'ical_feed',
        entityId: id,
        previousValue: this.auditFeedValue(existing),
        description: 'ical_feed.deleted',
      });
    });

    return { deleted: true };
  }

  async rotateExportToken(id: string, propertyId: string) {
    const feed = await this.findByIdRaw(id, propertyId);
    if (feed.direction !== 'export') {
      throw new BadRequestException('Only export feeds have tokens');
    }

    const token = this.signExportToken(feed);
    const [updated] = await this.db
      .update(icalFeeds)
      .set({ tokenHash: hashToken(token), updatedAt: new Date() })
      .where(and(eq(icalFeeds.id, id), eq(icalFeeds.propertyId, propertyId)))
      .returning();
    if (!updated) throw new NotFoundException(`iCal feed ${id} not found`);

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'ical_feed',
      entityId: id,
      description: 'ical_feed.token_rotated',
    });

    return { feed: this.publicFeed(updated), exportUrl: this.exportUrlForToken(token) };
  }

  async syncImportFeed(id: string, propertyId: string) {
    const feed = await this.findByIdRaw(id, propertyId);
    if (feed.direction !== 'import') {
      throw new BadRequestException('Only import feeds can be synced');
    }
    if (!feed.isActive) {
      throw new BadRequestException('Inactive import feeds cannot be synced');
    }
    if (!feed.sourceUrl) {
      throw new BadRequestException('Import feed has no sourceUrl');
    }

    try {
      await assertSafeOutboundUrl(feed.sourceUrl);
      const ics = await this.fetchIcs(feed.sourceUrl);
      const parsed = mergeBusyBlocks(parseIcsBusyBlocks(ics));
      const values = parsed.map((block) => this.blockInsertValue(feed, block));

      const result = await this.db.transaction(async (tx: any) => {
        await tx
          .delete(icalBlocks)
          .where(and(eq(icalBlocks.feedId, id), eq(icalBlocks.propertyId, propertyId)));
        if (values.length > 0) {
          await tx.insert(icalBlocks).values(values);
        }
        const [updated] = await tx
          .update(icalFeeds)
          .set({
            lastSyncAt: new Date(),
            lastSyncStatus: 'success',
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(and(eq(icalFeeds.id, id), eq(icalFeeds.propertyId, propertyId)))
          .returning();
        await tx.insert(auditLogs).values({
          propertyId,
          action: 'update',
          entityType: 'ical_feed',
          entityId: id,
          newValue: { blocksImported: values.length },
          description: 'ical_feed.synced',
        });
        return updated;
      });

      return { feed: this.publicFeed(result), blocksImported: values.length };
    } catch (err) {
      const message = err instanceof UnsafeUrlError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown iCal sync error';
      await this.markSyncFailed(id, propertyId, message);
      throw new BadRequestException(`iCal import failed: ${message}`);
    }
  }

  async listBlocks(feedId: string, dto: ListIcalBlocksDto) {
    await this.findByIdRaw(feedId, dto.propertyId);
    const conditions = [
      eq(icalBlocks.feedId, feedId),
      eq(icalBlocks.propertyId, dto.propertyId),
    ];
    if (dto.startDate) conditions.push(gt(icalBlocks.endDate, dto.startDate));
    if (dto.endDate) conditions.push(lt(icalBlocks.startDate, dto.endDate));

    return this.db
      .select()
      .from(icalBlocks)
      .where(and(...conditions))
      .orderBy(icalBlocks.startDate);
  }

  async listOverlappingBlocks(
    propertyId: string,
    roomTypeId: string,
    startDate: string,
    endDate: string,
    db?: any,
  ) {
    const conn = db ?? this.db;
    return conn
      .select({
        id: icalBlocks.id,
        feedId: icalBlocks.feedId,
        roomTypeId: icalBlocks.roomTypeId,
        startDate: icalBlocks.startDate,
        endDate: icalBlocks.endDate,
        summary: icalBlocks.summary,
      })
      .from(icalBlocks)
      .innerJoin(
        icalFeeds,
        and(
          eq(icalFeeds.id, icalBlocks.feedId),
          eq(icalFeeds.propertyId, propertyId),
          eq(icalFeeds.isActive, true),
          eq(icalFeeds.direction, 'import'),
        ),
      )
      .where(
        and(
          eq(icalBlocks.propertyId, propertyId),
          eq(icalBlocks.roomTypeId, roomTypeId),
          lt(icalBlocks.startDate, endDate),
          gt(icalBlocks.endDate, startDate),
        ),
      );
  }

  async exportCalendar(token: string) {
    const feed = await this.verifyExportToken(token);
    const excludedStatuses = ['cancelled', 'no_show', 'checked_out'] as const;
    const rows = await this.db
      .select({
        id: reservations.id,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, feed.propertyId),
          eq(reservations.roomTypeId, feed.roomTypeId),
          notInArray(reservations.status, excludedStatuses as any),
        ),
      )
      .orderBy(reservations.arrivalDate);

    return buildIcsCalendar(rows.map((row: any) => ({
      uid: `${row.id}@haip`,
      startDate: row.arrivalDate,
      endDate: row.departureDate,
      summary: 'Busy',
    })));
  }

  private async findByIdRaw(id: string, propertyId: string): Promise<IcalFeedRow> {
    const [feed] = await this.db
      .select()
      .from(icalFeeds)
      .where(and(eq(icalFeeds.id, id), eq(icalFeeds.propertyId, propertyId)));
    if (!feed) throw new NotFoundException(`iCal feed ${id} not found`);
    return feed;
  }

  private async assertRoomTypeAtProperty(roomTypeId: string, propertyId: string) {
    const [roomType] = await this.db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.propertyId, propertyId)));
    if (!roomType) {
      throw new BadRequestException(`room type ${roomTypeId} not found in this property`);
    }
  }

  private async verifyExportToken(token: string): Promise<IcalFeedRow> {
    const payload = this.parseAndVerifyToken(token);
    const [feed] = await this.db
      .select()
      .from(icalFeeds)
      .where(
        and(
          eq(icalFeeds.id, payload.feedId),
          eq(icalFeeds.propertyId, payload.propertyId),
          eq(icalFeeds.roomTypeId, payload.roomTypeId),
          eq(icalFeeds.direction, 'export'),
          eq(icalFeeds.isActive, true),
        ),
      );
    if (!feed || !feed.tokenHash || feed.tokenHash !== hashToken(token)) {
      throw new UnauthorizedException('Invalid iCal feed token');
    }
    return feed;
  }

  private signExportToken(feed: Pick<IcalFeedRow, 'id' | 'propertyId' | 'roomTypeId'>): string {
    const payload: ExportTokenPayload = {
      kind: 'ical-export',
      feedId: feed.id,
      propertyId: feed.propertyId,
      roomTypeId: feed.roomTypeId,
      nonce: randomBytes(16).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.signingSecret()).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private parseAndVerifyToken(token: string): ExportTokenPayload {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) {
      throw new UnauthorizedException('Invalid iCal feed token');
    }
    const expected = createHmac('sha256', this.signingSecret()).update(encoded).digest('base64url');
    if (!safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid iCal feed token');
    }

    let parsed: Partial<ExportTokenPayload>;
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<ExportTokenPayload>;
    } catch {
      throw new UnauthorizedException('Invalid iCal feed token');
    }
    if (
      parsed.kind !== 'ical-export' ||
      !parsed.feedId ||
      !parsed.propertyId ||
      !parsed.roomTypeId ||
      !parsed.nonce
    ) {
      throw new UnauthorizedException('Invalid iCal feed token');
    }
    return parsed as ExportTokenPayload;
  }

  private exportUrlForToken(token: string): string {
    const base = (
      this.config.get<string>('PUBLIC_API_BASE_URL') ??
      this.config.get<string>('API_BASE_URL') ??
      ''
    ).replace(/\/$/, '');
    return `${base}/ical/export.ics?token=${encodeURIComponent(token)}`;
  }

  private signingSecret(): string {
    return (
      this.config.get<string>('ICAL_SIGNING_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'dev-ical-signing-secret-change-me'
    );
  }

  private async fetchIcs(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private blockInsertValue(feed: IcalFeedRow, block: IcalBusyBlock) {
    const source = `${block.externalUid}|${block.startDate}|${block.endDate}|${block.summary ?? ''}`;
    return {
      propertyId: feed.propertyId,
      feedId: feed.id,
      roomTypeId: feed.roomTypeId,
      externalUid: block.externalUid,
      startDate: block.startDate,
      endDate: block.endDate,
      summary: block.summary ?? null,
      sourceChecksum: createHash('sha256').update(source).digest('hex'),
    };
  }

  private async markSyncFailed(id: string, propertyId: string, message: string) {
    await this.db
      .update(icalFeeds)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: 'failed',
        lastSyncError: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(and(eq(icalFeeds.id, id), eq(icalFeeds.propertyId, propertyId)));
  }

  private publicFeed(feed: IcalFeedRow) {
    const safe = { ...feed };
    delete (safe as { tokenHash?: string | null }).tokenHash;
    return safe;
  }

  private auditFeedValue(feed: IcalFeedRow) {
    return {
      id: feed.id,
      propertyId: feed.propertyId,
      roomTypeId: feed.roomTypeId,
      direction: feed.direction,
      name: feed.name,
      sourceUrl: feed.sourceUrl,
      isActive: feed.isActive,
      lastSyncAt: feed.lastSyncAt,
      lastSyncStatus: feed.lastSyncStatus,
    };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
