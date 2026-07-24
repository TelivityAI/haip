import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  ratePlans,
  roomTypes,
  turnawayReasonCodes,
  turnaways,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import {
  CreateTurnawayDto,
  CreateTurnawayReasonCodeDto,
  ListTurnawaysDto,
} from './dto/turnaways.dto';

@Injectable()
export class TurnawaysService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async createReasonCode(propertyId: string, dto: CreateTurnawayReasonCodeDto) {
    const [reasonCode] = await this.db
      .insert(turnawayReasonCodes)
      .values({
        propertyId,
        code: dto.code,
        description: dto.description,
        type: dto.type,
        isActive: dto.isActive ?? true,
      })
      .returning();

    return reasonCode;
  }

  async listReasonCodes(propertyId: string) {
    return this.db
      .select()
      .from(turnawayReasonCodes)
      .where(eq(turnawayReasonCodes.propertyId, propertyId))
      .orderBy(turnawayReasonCodes.code);
  }

  async create(propertyId: string, dto: CreateTurnawayDto) {
    if (dto.roomTypeId) {
      await this.assertPropertyFk(roomTypes, dto.roomTypeId, propertyId, 'room type');
    }
    if (dto.ratePlanId) {
      await this.assertPropertyFk(ratePlans, dto.ratePlanId, propertyId, 'rate plan');
    }
    if (dto.reasonCodeId) {
      await this.assertPropertyFk(turnawayReasonCodes, dto.reasonCodeId, propertyId, 'reason code');
    }

    const [turnaway] = await this.db
      .insert(turnaways)
      .values({
        propertyId,
        arrivalDate: dto.arrivalDate,
        nights: dto.nights ?? 1,
        roomsRequested: dto.roomsRequested ?? 1,
        adults: dto.adults ?? 1,
        children: dto.children ?? 0,
        roomTypeId: dto.roomTypeId,
        ratePlanId: dto.ratePlanId,
        reasonCodeId: dto.reasonCodeId,
        type: dto.type,
        channel: dto.channel,
        quotedRateAmount: dto.quotedRateAmount,
        currencyCode: dto.currencyCode,
        comment: dto.comment,
      })
      .returning();

    return turnaway;
  }

  async list(dto: ListTurnawaysDto) {
    const conditions: any[] = [eq(turnaways.propertyId, dto.propertyId)];
    if (dto.from) conditions.push(gte(turnaways.arrivalDate, dto.from));
    if (dto.to) conditions.push(lte(turnaways.arrivalDate, dto.to));

    return this.db
      .select()
      .from(turnaways)
      .where(and(...conditions))
      .orderBy(desc(turnaways.createdAt));
  }

  async summary(dto: ListTurnawaysDto) {
    const rows = await this.list(dto);
    const reasonIds = [...new Set(rows.map((row: any) => row.reasonCodeId).filter(Boolean))];
    const reasonRows =
      reasonIds.length > 0
        ? await this.db
            .select({
              id: turnawayReasonCodes.id,
              code: turnawayReasonCodes.code,
              description: turnawayReasonCodes.description,
              type: turnawayReasonCodes.type,
            })
            .from(turnawayReasonCodes)
            .where(
              and(
                eq(turnawayReasonCodes.propertyId, dto.propertyId),
                inArray(turnawayReasonCodes.id, reasonIds as string[]),
              ),
            )
        : [];

    const reasonsById = new Map<
      string,
      { id: string; code: string; description: string; type: string }
    >(reasonRows.map((row: any) => [row.id, row]));
    const byType = rows.reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row.type] = (acc[row.type] ?? 0) + 1;
        return acc;
      },
      {},
    );

    const byReasonMap = new Map<
      string,
      {
        reasonCodeId: string | null;
        code: string | null;
        description: string | null;
        type: string;
        count: number;
      }
    >();

    for (const row of rows) {
      const reason = row.reasonCodeId
        ? reasonsById.get(row.reasonCodeId)
        : null;
      const key = row.reasonCodeId ?? `unclassified:${row.type}`;
      const existing = byReasonMap.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byReasonMap.set(key, {
        reasonCodeId: row.reasonCodeId ?? null,
        code: reason?.code ?? null,
        description: reason?.description ?? null,
        type: row.type,
        count: 1,
      });
    }

    return {
      total: rows.length,
      byType,
      byReason: [...byReasonMap.values()],
    };
  }

  private async assertPropertyFk(
    table: { id: any; propertyId: any },
    id: string,
    propertyId: string,
    label: string,
  ) {
    const [row] = await this.db
      .select({ id: table.id })
      .from(table as any)
      .where(and(eq(table.id, id), eq(table.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`${label} ${id} not found in this property`);
    }
  }
}
