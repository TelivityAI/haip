import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, lte, gte } from 'drizzle-orm';
import { ratePlans, rateRestrictions, roomTypes, cancellationPolicies, groupProfiles } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { CreateRateRestrictionDto } from './dto/create-rate-restriction.dto';
import { UpdateRateRestrictionDto } from './dto/update-rate-restriction.dto';

@Injectable()
export class RatePlanService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Enforce rate-plan restrictions for a stay [checkIn, checkOut). Throws 400 if
   * the plan is not sellable: stop-sell (closed), closed-to-arrival on the
   * check-in date, closed-to-departure on the check-out date, or a min/max
   * length-of-stay violation.
   *
   * The BOOK path MUST call this. SEARCH only *surfaces* restrictions (it doesn't
   * hard-block CTA/CTD), so without this guard a direct create-reservation call —
   * including one driven by an LLM — could book a date the hotel marked unbookable.
   */
  async assertSellable(
    propertyId: string,
    ratePlanId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<void> {
    const nights = Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000,
    );
    if (!(nights > 0)) {
      throw new BadRequestException('Check-out must be after check-in');
    }

    // Restrictions overlapping the stay (scoped by property — multi-tenancy).
    const restrictions = await this.db
      .select()
      .from(rateRestrictions)
      .where(
        and(
          eq(rateRestrictions.propertyId, propertyId),
          eq(rateRestrictions.ratePlanId, ratePlanId),
          lte(rateRestrictions.startDate, checkOut),
          gte(rateRestrictions.endDate, checkIn),
        ),
      );

    // A restriction row "covers" a date when its range includes it (ISO dates compare lexically).
    const covers = (r: any, date: string) => r.startDate <= date && r.endDate >= date;

    if (restrictions.some((r: any) => r.isClosed)) {
      throw new BadRequestException('Rate plan is closed (stop-sell) for the selected dates');
    }
    if (restrictions.some((r: any) => r.closedToArrival && covers(r, checkIn))) {
      throw new BadRequestException('Rate plan is closed to arrival on the check-in date');
    }
    if (restrictions.some((r: any) => r.closedToDeparture && covers(r, checkOut))) {
      throw new BadRequestException('Rate plan is closed to departure on the check-out date');
    }

    const minLos = restrictions.reduce(
      (m: number | undefined, r: any) => (r.minLos ? Math.max(m ?? 0, r.minLos) : m),
      undefined,
    );
    const maxLos = restrictions.reduce(
      (m: number | undefined, r: any) => (r.maxLos ? Math.min(m ?? Infinity, r.maxLos) : m),
      undefined,
    );
    if (minLos && nights < minLos) {
      throw new BadRequestException(`Minimum length of stay is ${minLos} night(s)`);
    }
    if (maxLos && maxLos !== Infinity && nights > maxLos) {
      throw new BadRequestException(`Maximum length of stay is ${maxLos} night(s)`);
    }
  }

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
    if (dto.cancellationPolicyId) {
      const [policy] = await this.db
        .select({ id: cancellationPolicies.id })
        .from(cancellationPolicies)
        .where(
          and(
            eq(cancellationPolicies.id, dto.cancellationPolicyId),
            eq(cancellationPolicies.propertyId, dto.propertyId),
          ),
        );
      if (!policy) {
        throw new BadRequestException(
          `cancellation policy ${dto.cancellationPolicyId} not found in this property`,
        );
      }
    }
    if (dto.groupProfileId) {
      const [gp] = await this.db
        .select({ id: groupProfiles.id })
        .from(groupProfiles)
        .where(
          and(
            eq(groupProfiles.id, dto.groupProfileId),
            eq(groupProfiles.propertyId, dto.propertyId),
          ),
        );
      if (!gp) {
        throw new BadRequestException(
          `group profile ${dto.groupProfileId} not found in this property`,
        );
      }
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
    if (dto.cancellationPolicyId) {
      const [policy] = await this.db
        .select({ id: cancellationPolicies.id })
        .from(cancellationPolicies)
        .where(
          and(
            eq(cancellationPolicies.id, dto.cancellationPolicyId),
            eq(cancellationPolicies.propertyId, propertyId),
          ),
        );
      if (!policy) {
        throw new BadRequestException(
          `cancellation policy ${dto.cancellationPolicyId} not found in this property`,
        );
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
