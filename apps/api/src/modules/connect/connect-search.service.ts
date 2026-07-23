import { Injectable, Inject } from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { properties, roomTypes, ratePlans, rateRestrictions } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from '../reservation/availability.service';
import { PolicyService } from '../policy/policy.service';
import type { AgentSearchDto } from './dto/agent-search.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class ConnectSearchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly availabilityService: AvailabilityService,
    private readonly policyService: PolicyService,
  ) {}

  /**
   * Agent-facing search (KB Agent 4.1 — Hotel Search Aggregator).
   * Returns properties with room types, availability, rates, nightly breakdown.
   */
  async search(dto: AgentSearchDto) {
    const startTime = Date.now();
    const searchId = randomUUID();

    // Bug 7: paginate at SQL level (LIMIT/OFFSET) rather than fetching every
    // matching property and slicing in memory. DTO enforces Max(100) on limit.
    const limit = Math.min(dto.limit ?? 20, 100);
    const offset = dto.offset ?? 0;
    const matchedProperties = await this.findProperties(dto, limit, offset);

    const results = [];
    for (const property of matchedProperties) {
      const result = await this.buildPropertyResult(property, dto);
      if (result.roomTypes.length > 0) {
        results.push(result);
      }
    }

    return {
      source: 'haip',
      sourceVersion: '1.0.0',
      searchId,
      timestamp: new Date().toISOString(),
      results,
      totalResults: results.length,
      responseTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Get detailed property content for Agent 4.2 (Dedup) and 4.3 (Content Normalization).
   */
  async getPropertyDetail(propertyId: string) {
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) return null;

    const types = await this.db
      .select()
      .from(roomTypes)
      .where(and(eq(roomTypes.propertyId, propertyId), eq(roomTypes.isActive, true)));

    const settings = (property.settings ?? {}) as Record<string, unknown>;

    return {
      sourcePropertyId: property.id,
      propertyName: property.name,
      propertyCode: property.code,
      description: property.description,
      starRating: property.starRating,
      address: {
        street: property.addressLine1,
        city: property.city,
        state: property.stateProvince,
        country: property.countryCode,
        postalCode: property.postalCode,
      },
      contact: {
        phone: property.phone,
        email: property.email,
        website: property.website,
      },
      timezone: property.timezone,
      currencyCode: property.currencyCode,
      totalRooms: property.totalRooms,
      roomTypes: types.map((t: any) => ({
        id: t.id,
        name: t.name,
        code: t.code,
        description: t.description,
        baseOccupancy: t.defaultOccupancy,
        maxOccupancy: t.maxOccupancy,
        maxAdults: t.maxOccupancy,
        maxChildren: Math.max(0, t.maxOccupancy - t.defaultOccupancy),
        bedType: t.bedType,
        isAccessible: t.isAccessible,
        amenities: t.amenities ?? [],
        totalRooms: t.maxOccupancy, // Will be refined when room count is available
      })),
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      policies: {
        cancellationDefault: 'Varies by rate plan',
        depositRequired: !!(settings['depositPercentage'] && (settings['depositPercentage'] as number) > 0),
        petsAllowed: undefined,
      },
    };
  }

  /**
   * List all properties (for Agent 4.2 background sync).
   */
  async listProperties() {
    const allProperties = await this.db
      .select()
      .from(properties)
      .where(eq(properties.isActive, true));

    return allProperties.map((p: any) => ({
      sourcePropertyId: p.id,
      propertyName: p.name,
      propertyCode: p.code,
      city: p.city,
      country: p.countryCode,
      starRating: p.starRating,
      totalRooms: p.totalRooms,
    }));
  }

  // --- Private ---

  private async findProperties(dto: AgentSearchDto, limit?: number, offset?: number) {
    if (dto.propertyId) {
      const [property] = await this.db
        .select()
        .from(properties)
        .where(and(eq(properties.id, dto.propertyId), eq(properties.isActive, true)));
      return property ? [property] : [];
    }

    const conditions = [eq(properties.isActive, true)];

    if (dto.city) {
      // Case-insensitive city match using ilike
      const { sql } = await import('drizzle-orm');
      conditions.push(sql`LOWER(${properties.city}) = LOWER(${dto.city})`);
    }

    // Bug 7: LIMIT/OFFSET pushed to SQL so a large tenant doesn't load the
    // entire property catalog into memory per search call.
    const effectiveLimit = Math.min(limit ?? 20, 100);
    const effectiveOffset = offset ?? 0;

    return this.db
      .select()
      .from(properties)
      .where(and(...conditions))
      .limit(effectiveLimit)
      .offset(effectiveOffset);
  }

  private async buildPropertyResult(property: any, dto: AgentSearchDto) {
    const settings = (property.settings ?? {}) as Record<string, unknown>;
    const taxRate = (settings['taxRate'] as number) ?? 0;

    // Get room types
    let types = await this.db
      .select()
      .from(roomTypes)
      .where(and(eq(roomTypes.propertyId, property.id), eq(roomTypes.isActive, true)));

    // Filter by accessible
    if (dto.accessibleOnly) {
      types = types.filter((t: any) => t.isAccessible);
    }

    // Filter by amenities
    if (dto.amenities?.length) {
      types = types.filter((t: any) => {
        const roomAmenities = (t.amenities ?? []) as string[];
        return dto.amenities!.every((a) => roomAmenities.includes(a));
      });
    }

    // Get availability for the full date range
    const availability = await this.availabilityService.searchAvailability(
      property.id,
      dto.checkIn,
      dto.checkOut,
    );

    // Build room type results
    const roomTypeResults = [];
    for (const type of types) {
      // Get minimum availability across all dates for this room type
      const typeAvailability = availability.filter((a) => a.roomTypeId === type.id);
      const minAvailable = typeAvailability.length > 0
        ? Math.min(...typeAvailability.map((a) => a.available))
        : 0;
      const totalInventory = typeAvailability.length > 0 ? typeAvailability[0]!.totalRooms : 0;

      if (minAvailable <= 0) continue;

      // Get rate plans for this room type
      const plans = await this.db
        .select()
        .from(ratePlans)
        .where(
          and(
            eq(ratePlans.propertyId, property.id),
            eq(ratePlans.roomTypeId, type.id),
            eq(ratePlans.isActive, true),
          ),
        );

      // Filter by rate type
      const filteredPlans = dto.rateType
        ? plans.filter((p: any) => p.type === dto.rateType)
        : plans;

      const rates = [];
      for (const plan of filteredPlans) {
        const rateResult = await this.buildRateResult(
          plan,
          property,
          dto.checkIn,
          dto.checkOut,
          taxRate,
        );
        if (rateResult) rates.push(rateResult);
      }

      if (rates.length > 0) {
        roomTypeResults.push({
          roomTypeId: type.id,
          roomTypeName: type.name,
          description: type.description,
          maxOccupancy: type.maxOccupancy,
          bedType: type.bedType,
          isAccessible: type.isAccessible,
          amenities: type.amenities ?? [],
          available: minAvailable,
          totalInventory,
          rates,
        });
      }
    }

    return {
      sourcePropertyId: property.id,
      propertyName: property.name,
      propertyCode: property.code,
      chainCode: property.gdsChainCode,
      address: {
        street: property.addressLine1,
        city: property.city,
        state: property.stateProvince,
        country: property.countryCode,
        postalCode: property.postalCode,
      },
      starRating: property.starRating,
      phone: property.phone,
      email: property.email,
      website: property.website,
      roomTypes: roomTypeResults,
      contentScore: this.calculateContentScore(property),
    };
  }

  private async buildRateResult(
    plan: any,
    property: any,
    checkIn: string,
    checkOut: string,
    taxRate: number,
  ) {
    const baseAmount = new Decimal(plan.baseAmount).toNumber();

    // Get restrictions for the date range
    const restrictions = await this.db
      .select()
      .from(rateRestrictions)
      .where(
        and(
          eq(rateRestrictions.ratePlanId, plan.id),
          lte(rateRestrictions.startDate, checkOut),
          gte(rateRestrictions.endDate, checkIn),
        ),
      );

    // Check if rate is closed for any date in range
    const isClosed = restrictions.some((r: any) => r.isClosed);
    if (isClosed) return null;

    // Check CTA/CTD
    const closedToArrival = restrictions.some((r: any) => r.closedToArrival);
    const closedToDeparture = restrictions.some((r: any) => r.closedToDeparture);

    // Get min/max LOS
    const minLos = restrictions.reduce((min: number | undefined, r: any) =>
      r.minLos ? Math.max(min ?? 0, r.minLos) : min, undefined);
    const maxLos = restrictions.reduce((max: number | undefined, r: any) =>
      r.maxLos ? Math.min(max ?? Infinity, r.maxLos) : max, undefined);

    // Calculate nights
    const arrival = new Date(checkIn);
    const departure = new Date(checkOut);
    const nights = Math.ceil((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));

    // Check LOS constraints
    if (minLos && nights < minLos) return null;
    if (maxLos && maxLos !== Infinity && nights > maxLos) return null;

    // Build nightly breakdown — Decimal for all per-night money math
    const nightlyBreakdown = [];
    let totalAmountDec = new Decimal(0);
    const taxRateDec = new Decimal(taxRate).div(100);
    for (let i = 0; i < nights; i++) {
      const date = new Date(arrival);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0]!;

      // Check for day-of-week overrides
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      let nightRateDec = new Decimal(baseAmount);

      for (const restriction of restrictions) {
        const overrides = (restriction.dayOfWeekOverrides ?? {}) as Record<string, number>;
        if (overrides[dayName]) {
          nightRateDec = new Decimal(baseAmount).plus(overrides[dayName]!);
        }
      }

      const taxAmountDec = nightRateDec.times(taxRateDec);
      nightlyBreakdown.push({
        date: dateStr,
        baseRate: Number(nightRateDec.toFixed(2)),
        taxAmount: Number(taxAmountDec.toFixed(2)),
        totalRate: Number(nightRateDec.plus(taxAmountDec).toFixed(2)),
      });
      totalAmountDec = totalAmountDec.plus(nightRateDec).plus(taxAmountDec);
    }
    const totalAmount = Number(totalAmountDec.toFixed(2));

    // Build cancellation policy from linked rate-plan policy (or default)
    const cancellationPolicy = await this.policyService.getPolicySummary(
      plan.propertyId,
      plan.id,
    );

    return {
      ratePlanId: plan.id,
      ratePlanName: plan.name,
      ratePlanCode: plan.code,
      rateType: plan.type,
      totalAmount,
      currencyCode: plan.currencyCode,
      nightlyBreakdown,
      cancellationPolicy: {
        type: cancellationPolicy.type,
        penaltyType: cancellationPolicy.penaltyType,
        description: cancellationPolicy.description,
      },
      minLos: minLos ?? undefined,
      maxLos: maxLos === Infinity ? undefined : maxLos,
      closedToArrival,
      closedToDeparture,
      channelCodes: plan.channelCodes,
    };
  }

  private calculateContentScore(property: any): number {
    let score = 0;
    const checks = [
      property.name,
      property.description,
      property.addressLine1,
      property.city,
      property.countryCode,
      property.phone,
      property.email,
      property.website,
      property.starRating,
      property.timezone,
    ];

    for (const check of checks) {
      if (check != null && check !== '') score += 10;
    }

    return score;
  }
}
