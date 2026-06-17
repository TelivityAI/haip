import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql, inArray, lt } from 'drizzle-orm';
import {
  allotmentBlocks,
  allotmentBlockInventory,
  groupProfiles,
  ratePlans,
  roomTypes,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { AvailabilityService } from '../reservation/availability.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { ListBlocksDto } from './dto/list-blocks.dto';
import { SetInventoryDto } from './dto/set-inventory.dto';

@Injectable()
export class AllotmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async createBlock(dto: CreateBlockDto) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('endDate must be after startDate');
    }
    // FK ownership (security audit follow-on): caller-supplied groupProfileId
    // and (optional) ratePlanId must belong to dto.propertyId. Schema FK only
    // constrains row id.
    const [gp] = await this.db
      .select({ id: groupProfiles.id })
      .from(groupProfiles)
      .where(and(eq(groupProfiles.id, dto.groupProfileId), eq(groupProfiles.propertyId, dto.propertyId)));
    if (!gp) {
      throw new BadRequestException(`group profile ${dto.groupProfileId} not found in this property`);
    }
    if (dto.ratePlanId) {
      const [rp] = await this.db
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(and(eq(ratePlans.id, dto.ratePlanId), eq(ratePlans.propertyId, dto.propertyId)));
      if (!rp) {
        throw new BadRequestException(`rate plan ${dto.ratePlanId} not found in this property`);
      }
    }
    const [block] = await this.db
      .insert(allotmentBlocks)
      .values({
        propertyId: dto.propertyId,
        groupProfileId: dto.groupProfileId,
        name: dto.name,
        ratePlanId: dto.ratePlanId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        cutoffDate: dto.cutoffDate,
        autoRelease: dto.autoRelease ?? true,
        shoulderStart: dto.shoulderStart,
        shoulderEnd: dto.shoulderEnd,
        minLos: dto.minLos,
        maxLos: dto.maxLos,
        groupCode: dto.groupCode,
        status: (dto.status as any) ?? 'tentative',
      })
      .returning();

    await this.webhookService.emit(
      'group.block_created',
      'allotment_block',
      block.id,
      { name: block.name, groupProfileId: block.groupProfileId, status: block.status },
      block.propertyId,
    );

    return block;
  }

  async findBlockById(id: string, propertyId: string) {
    const [block] = await this.db
      .select()
      .from(allotmentBlocks)
      .where(and(eq(allotmentBlocks.id, id), eq(allotmentBlocks.propertyId, propertyId)));
    if (!block) {
      throw new NotFoundException(`Allotment block ${id} not found`);
    }
    return block;
  }

  async listBlocks(dto: ListBlocksDto) {
    const conditions: any[] = [eq(allotmentBlocks.propertyId, dto.propertyId)];
    if (dto.groupProfileId) {
      conditions.push(eq(allotmentBlocks.groupProfileId, dto.groupProfileId));
    }
    if (dto.status) conditions.push(eq(allotmentBlocks.status, dto.status as any));

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(allotmentBlocks)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(allotmentBlocks.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(allotmentBlocks)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async updateBlock(id: string, propertyId: string, dto: UpdateBlockDto) {
    await this.findBlockById(id, propertyId);
    // FK ownership (security audit follow-on): updateBlock takes an optional
    // ratePlanId. Without scoping to propertyId, a caller could redirect a block
    // at a foreign tenant's rate plan.
    if (dto.ratePlanId) {
      const [rp] = await this.db
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(and(eq(ratePlans.id, dto.ratePlanId), eq(ratePlans.propertyId, propertyId)));
      if (!rp) {
        throw new BadRequestException(`rate plan ${dto.ratePlanId} not found in this property`);
      }
    }
    const [updated] = await this.db
      .update(allotmentBlocks)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(allotmentBlocks.id, id), eq(allotmentBlocks.propertyId, propertyId)))
      .returning();
    return updated;
  }

  /**
   * Upsert the held inventory for a (date, room-type) on a block (KB 14.5).
   * Held rooms reduce sellable availability, so the requested allotment must
   * not exceed the rooms still sellable for that date/room-type per the
   * availability engine (over-allotment is rejected — KB 14.4).
   */
  async setInventory(blockId: string, propertyId: string, dto: SetInventoryDto) {
    const block = await this.findBlockById(blockId, propertyId);
    if (block.status === 'released' || block.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot set inventory on a ${block.status} block`,
      );
    }
    // FK ownership (security audit follow-on): the caller's roomTypeId must
    // belong to this propertyId. Without this, a foreign room type id still
    // inserts an allotment row (availability lookup just returns 0 sellable,
    // and roomsAllotted=0 would pass — writing a cross-property FK).
    const [rt] = await this.db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, dto.roomTypeId), eq(roomTypes.propertyId, propertyId)));
    if (!rt) {
      throw new BadRequestException(`room type ${dto.roomTypeId} not found in this property`);
    }

    // Sellable availability for that single night/room-type. The availability
    // engine already nets out other blocks' member reservations (they hold
    // real reservations); we add back this block's existing allotment so a
    // re-set isn't double-counted against itself.
    const checkOut = this.nextDay(dto.stayDate);
    const availability = await this.availabilityService.searchAvailability(
      propertyId,
      dto.stayDate,
      checkOut,
      dto.roomTypeId,
    );
    const dayAvail = availability.find(
      (a: any) => a.roomTypeId === dto.roomTypeId && a.date === dto.stayDate,
    );
    const sellable = dayAvail?.available ?? 0;

    const [existing] = await this.db
      .select()
      .from(allotmentBlockInventory)
      .where(
        and(
          eq(allotmentBlockInventory.allotmentBlockId, blockId),
          eq(allotmentBlockInventory.propertyId, propertyId),
          eq(allotmentBlockInventory.stayDate, dto.stayDate),
          eq(allotmentBlockInventory.roomTypeId, dto.roomTypeId),
        ),
      );

    const alreadyHeldUnpicked = existing
      ? Math.max(0, Number(existing.roomsAllotted) - Number(existing.roomsPickedUp))
      : 0;
    // Picked-up rooms already became reservations and reduced availability, so
    // only the unsold portion of the prior allotment is "free" to re-claim.
    const ceiling = sellable + alreadyHeldUnpicked;

    const pickedUp = existing ? Number(existing.roomsPickedUp) : 0;
    if (dto.roomsAllotted < pickedUp) {
      throw new BadRequestException(
        `roomsAllotted (${dto.roomsAllotted}) cannot be below rooms already picked up (${pickedUp})`,
      );
    }
    if (dto.roomsAllotted - pickedUp > ceiling) {
      throw new BadRequestException(
        `Over-allotment: ${dto.roomsAllotted} rooms requested for ${dto.stayDate} exceeds sellable availability (${ceiling})`,
      );
    }

    let row;
    if (existing) {
      [row] = await this.db
        .update(allotmentBlockInventory)
        .set({ roomsAllotted: dto.roomsAllotted, updatedAt: new Date() })
        .where(eq(allotmentBlockInventory.id, existing.id))
        .returning();
    } else {
      [row] = await this.db
        .insert(allotmentBlockInventory)
        .values({
          propertyId,
          allotmentBlockId: blockId,
          stayDate: dto.stayDate,
          roomTypeId: dto.roomTypeId,
          roomsAllotted: dto.roomsAllotted,
          roomsPickedUp: 0,
        })
        .returning();
    }

    await this.webhookService.emit(
      'group.inventory_set',
      'allotment_block',
      blockId,
      { stayDate: dto.stayDate, roomTypeId: dto.roomTypeId, roomsAllotted: dto.roomsAllotted },
      propertyId,
    );

    return row;
  }

  /**
   * Pickup report: per date/room-type allotted vs picked up, plus totals and
   * the overall pickup rate (KB 14.5).
   */
  async getPickup(blockId: string, propertyId: string) {
    await this.findBlockById(blockId, propertyId);
    const rows = await this.db
      .select()
      .from(allotmentBlockInventory)
      .where(
        and(
          eq(allotmentBlockInventory.allotmentBlockId, blockId),
          eq(allotmentBlockInventory.propertyId, propertyId),
        ),
      )
      .orderBy(allotmentBlockInventory.stayDate);

    const detail = rows.map((r: any) => {
      const allotted = Number(r.roomsAllotted);
      const pickedUp = Number(r.roomsPickedUp);
      return {
        stayDate: r.stayDate,
        roomTypeId: r.roomTypeId,
        roomsAllotted: allotted,
        roomsPickedUp: pickedUp,
        remaining: Math.max(0, allotted - pickedUp),
        pickupRate: allotted > 0 ? Math.round((pickedUp / allotted) * 1000) / 1000 : 0,
      };
    });

    const totalAllotted = detail.reduce((s: number, r: any) => s + r.roomsAllotted, 0);
    const totalPickedUp = detail.reduce((s: number, r: any) => s + r.roomsPickedUp, 0);

    return {
      blockId,
      detail,
      totals: {
        roomsAllotted: totalAllotted,
        roomsPickedUp: totalPickedUp,
        remaining: Math.max(0, totalAllotted - totalPickedUp),
        pickupRate: totalAllotted > 0 ? Math.round((totalPickedUp / totalAllotted) * 1000) / 1000 : 0,
      },
    };
  }

  /**
   * Release a block (KB 14.4). Unsold rooms return to general inventory: for
   * each inventory row we drop roomsAllotted down to roomsPickedUp so the block
   * no longer holds the unpicked rooms; the block is marked 'released'.
   */
  async releaseBlock(blockId: string, propertyId: string) {
    const block = await this.findBlockById(blockId, propertyId);
    if (block.status === 'released' || block.status === 'cancelled') {
      throw new BadRequestException(`Block is already ${block.status}`);
    }

    return this.db.transaction(async (tx: any) => {
      // Free the unpicked rooms: allotted := picked_up for every row.
      await tx
        .update(allotmentBlockInventory)
        .set({
          roomsAllotted: sql`${allotmentBlockInventory.roomsPickedUp}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(allotmentBlockInventory.allotmentBlockId, blockId),
            eq(allotmentBlockInventory.propertyId, propertyId),
          ),
        );

      const [updated] = await tx
        .update(allotmentBlocks)
        .set({ status: 'released', updatedAt: new Date() })
        .where(and(eq(allotmentBlocks.id, blockId), eq(allotmentBlocks.propertyId, propertyId)))
        .returning();

      await this.webhookService.emit(
        'group.block_released',
        'allotment_block',
        blockId,
        { name: updated.name, status: updated.status },
        propertyId,
      );

      return updated;
    });
  }

  /**
   * Cutoff sweep (KB 14.4): release every auto_release block in
   * tentative/definite whose cutoff_date is in the past. Exposed as an endpoint
   * for an external scheduler / night-audit to call (no in-process cron).
   */
  async processCutoffs(propertyId: string) {
    const today = new Date().toISOString().split('T')[0]!;
    const due = await this.db
      .select({ id: allotmentBlocks.id })
      .from(allotmentBlocks)
      .where(
        and(
          eq(allotmentBlocks.propertyId, propertyId),
          eq(allotmentBlocks.autoRelease, true),
          inArray(allotmentBlocks.status, ['tentative', 'definite'] as any),
          lt(allotmentBlocks.cutoffDate, today),
        ),
      );

    let released = 0;
    for (const b of due) {
      await this.releaseBlock(b.id, propertyId);
      released++;
    }
    return { released };
  }

  /**
   * Increment picked-up count for a (date, room-type) on a block — invoked when
   * a member reservation is created from a rooming list. Caller passes a tx.
   */
  async incrementPickup(
    blockId: string,
    propertyId: string,
    stayDate: string,
    roomTypeId: string,
    tx: any,
  ) {
    const db = tx ?? this.db;
    const [existing] = await db
      .select()
      .from(allotmentBlockInventory)
      .where(
        and(
          eq(allotmentBlockInventory.allotmentBlockId, blockId),
          eq(allotmentBlockInventory.propertyId, propertyId),
          eq(allotmentBlockInventory.stayDate, stayDate),
          eq(allotmentBlockInventory.roomTypeId, roomTypeId),
        ),
      );
    if (!existing) return null;
    const [row] = await db
      .update(allotmentBlockInventory)
      .set({
        roomsPickedUp: Number(existing.roomsPickedUp) + 1,
        updatedAt: new Date(),
      })
      .where(eq(allotmentBlockInventory.id, existing.id))
      .returning();
    return row;
  }

  private nextDay(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0]!;
  }
}
