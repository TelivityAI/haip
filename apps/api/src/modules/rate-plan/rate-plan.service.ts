import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { ratePlans, rateRestrictions, roomTypes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { CreateRateRestrictionDto } from './dto/create-rate-restriction.dto';
import { UpdateRateRestrictionDto } from './dto/update-rate-restriction.dto';

@Injectable()
export class RatePlanService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  // --- Rate Plans ---

  async create(dto: CreateRatePlanDto) {
    // FK ownership (security audit follow-on): roomTypeId is required on the
    // DTO. Without scoping to dto.propertyId, a caller at property A could
    // create a rate plan pointing at property B's room type. The existing
    // derived-parent check below already scopes parentRatePlanId.
    const [rt] = await this.db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, dto.roomTypeId), eq(roomTypes.propertyId, dto.propertyId)));
    if (!rt) {
      throw new BadRequestException(`room type ${dto.roomTypeId} not found in this property`);
    }
    if (dto.type === 'derived') {
      if (!dto.parentRatePlanId || !dto.derivedAdjustmentType || !dto.derivedAdjustmentValue) {
        throw new BadRequestException(
          'Derived rate plans require parentRatePlanId, derivedAdjustmentType, and derivedAdjustmentValue',
        );
      }
      // Verify parent exists — must be in same property
      const [parent] = await this.db
        .select()
        .from(ratePlans)
        .where(
          and(
            eq(ratePlans.id, dto.parentRatePlanId),
            eq(ratePlans.propertyId, dto.propertyId),
          ),
        );
      if (!parent) {
        throw new NotFoundException(`Parent rate plan ${dto.parentRatePlanId} not found`);
      }
      // Prevent circular reference
      if (parent.parentRatePlanId === dto.parentRatePlanId) {
        throw new BadRequestException('Circular derived rate chain detected');
      }
    }

    const [ratePlan] = await this.db
      .insert(ratePlans)
      .values(dto)
      .returning();
    return ratePlan;
  }

  async findAll(propertyId: string) {
    return this.db
      .select()
      .from(ratePlans)
      .where(
        and(eq(ratePlans.propertyId, propertyId), eq(ratePlans.isActive, true)),
      );
  }

  async findById(id: string, propertyId: string) {
    const [ratePlan] = await this.db
      .select()
      .from(ratePlans)
      .where(and(eq(ratePlans.id, id), eq(ratePlans.propertyId, propertyId)));
    if (!ratePlan) {
      throw new NotFoundException(`Rate plan ${id} not found`);
    }
    return ratePlan;
  }

  async update(id: string, propertyId: string, dto: UpdateRatePlanDto) {
    // FK ownership (security audit follow-on): UpdateRatePlanDto omits propertyId
    // and roomTypeId but NOT parentRatePlanId. Without scoping that FK to the
    // request's propertyId, a caller could re-parent a rate plan onto another
    // tenant's chain. Verify before the update.
    if (dto.parentRatePlanId) {
      const [parent] = await this.db
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(and(eq(ratePlans.id, dto.parentRatePlanId), eq(ratePlans.propertyId, propertyId)));
      if (!parent) {
        throw new BadRequestException(`parent rate plan ${dto.parentRatePlanId} not found in this property`);
      }
    }
    const [ratePlan] = await this.db
      .update(ratePlans)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(ratePlans.id, id), eq(ratePlans.propertyId, propertyId)))
      .returning();
    if (!ratePlan) {
      throw new NotFoundException(`Rate plan ${id} not found`);
    }
    return ratePlan;
  }

  /**
   * Calculate the effective rate for a derived rate plan.
   * Follows the parent chain to get the base amount, then applies the adjustment.
   */
  async calculateDerivedRate(
    id: string,
    propertyId: string,
  ): Promise<{ effectiveRate: number; currency: string }> {
    const ratePlan = await this.findById(id, propertyId);

    if (ratePlan.type !== 'derived' || !ratePlan.parentRatePlanId) {
      return {
        effectiveRate: Number(ratePlan.baseAmount),
        currency: ratePlan.currencyCode,
      };
    }

    const parent = await this.findById(ratePlan.parentRatePlanId, propertyId);
    const parentAmount = Number(parent.baseAmount);
    const adjustmentValue = Number(ratePlan.derivedAdjustmentValue);

    let effectiveRate: number;
    if (ratePlan.derivedAdjustmentType === 'percentage') {
      effectiveRate = parentAmount * (1 + adjustmentValue / 100);
    } else {
      // fixed adjustment
      effectiveRate = parentAmount + adjustmentValue;
    }

    return {
      effectiveRate: Math.max(0, Number(effectiveRate.toFixed(2))),
      currency: ratePlan.currencyCode,
    };
  }

  // --- Rate Restrictions ---

  async createRestriction(
    ratePlanId: string,
    propertyId: string,
    dto: CreateRateRestrictionDto,
  ) {
    await this.findById(ratePlanId, propertyId); // Verify rate plan exists + tenant scope
    const [restriction] = await this.db
      .insert(rateRestrictions)
      .values({ ...dto, ratePlanId, propertyId })
      .returning();
    return restriction;
  }

  async findRestrictions(ratePlanId: string, propertyId: string) {
    await this.findById(ratePlanId, propertyId); // Verify rate plan exists + tenant scope
    return this.db
      .select()
      .from(rateRestrictions)
      .where(
        and(
          eq(rateRestrictions.ratePlanId, ratePlanId),
          eq(rateRestrictions.propertyId, propertyId),
        ),
      );
  }

  async updateRestriction(
    id: string,
    propertyId: string,
    dto: UpdateRateRestrictionDto,
  ) {
    const [restriction] = await this.db
      .update(rateRestrictions)
      .set({ ...dto, updatedAt: new Date() })
      .where(
        and(
          eq(rateRestrictions.id, id),
          eq(rateRestrictions.propertyId, propertyId),
        ),
      )
      .returning();
    if (!restriction) {
      throw new NotFoundException(`Rate restriction ${id} not found`);
    }
    return restriction;
  }

  async deleteRestriction(id: string, propertyId: string) {
    const [restriction] = await this.db
      .delete(rateRestrictions)
      .where(
        and(
          eq(rateRestrictions.id, id),
          eq(rateRestrictions.propertyId, propertyId),
        ),
      )
      .returning();
    if (!restriction) {
      throw new NotFoundException(`Rate restriction ${id} not found`);
    }
    return { deleted: true };
  }
}
