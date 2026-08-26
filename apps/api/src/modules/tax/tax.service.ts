import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, lte, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { taxProfiles, taxRules, guests } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateTaxProfileDto } from './dto/create-tax-profile.dto';
import { UpdateTaxProfileDto } from './dto/update-tax-profile.dto';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';
import type { TaxLineItem } from './dto/calculate-tax.dto';

@Injectable()
export class TaxService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  // ---------------------------------------------------------------------------
  // Tax Profile CRUD
  // ---------------------------------------------------------------------------

  async createProfile(dto: CreateTaxProfileDto) {
    const [profile] = await this.db
      .insert(taxProfiles)
      .values({
        propertyId: dto.propertyId,
        name: dto.name,
        jurisdictionCode: dto.jurisdictionCode,
        isActive: dto.isActive ?? true,
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: dto.effectiveTo,
      })
      .returning();
    return profile;
  }

  async updateProfile(id: string, propertyId: string, dto: UpdateTaxProfileDto) {
    await this.findProfile(id, propertyId);
    const [updated] = await this.db
      .update(taxProfiles)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(taxProfiles.id, id), eq(taxProfiles.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async findProfile(id: string, propertyId: string) {
    const [profile] = await this.db
      .select()
      .from(taxProfiles)
      .where(and(eq(taxProfiles.id, id), eq(taxProfiles.propertyId, propertyId)));
    if (!profile) throw new NotFoundException(`Tax profile ${id} not found`);
    return profile;
  }

  async findProfileWithRules(id: string, propertyId: string) {
    const profile = await this.findProfile(id, propertyId);
    const rules = await this.db
      .select()
      .from(taxRules)
      .where(eq(taxRules.taxProfileId, id))
      .orderBy(taxRules.sortOrder);
    return { ...profile, rules };
  }

  async listProfiles(propertyId: string) {
    return this.db
      .select()
      .from(taxProfiles)
      .where(eq(taxProfiles.propertyId, propertyId))
      .orderBy(taxProfiles.createdAt);
  }

  // ---------------------------------------------------------------------------
  // Tax Rule CRUD
  // ---------------------------------------------------------------------------

  async createRule(profileId: string, propertyId: string, dto: CreateTaxRuleDto) {
    await this.findProfile(profileId, propertyId);
    const [rule] = await this.db
      .insert(taxRules)
      .values({
        taxProfileId: profileId,
        name: dto.name,
        code: dto.code,
        type: dto.type,
        rate: dto.rate,
        splitPercentage:
          dto.splitPercentage !== undefined ? dto.splitPercentage.toString() : null,
        appliesToChargeTypes: dto.appliesToChargeTypes,
        exemptions: dto.exemptions,
        isCompounding: dto.isCompounding ?? false,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: dto.effectiveTo,
      })
      .returning();
    return rule;
  }

  async updateRule(ruleId: string, profileId: string, propertyId: string, dto: UpdateTaxRuleDto) {
    await this.findProfile(profileId, propertyId);
    const [existing] = await this.db
      .select()
      .from(taxRules)
      .where(and(eq(taxRules.id, ruleId), eq(taxRules.taxProfileId, profileId)));
    if (!existing) throw new NotFoundException(`Tax rule ${ruleId} not found`);

    const [updated] = await this.db
      .update(taxRules)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(taxRules.id, ruleId))
      .returning();
    return updated;
  }

  async deleteRule(ruleId: string, profileId: string, propertyId: string) {
    await this.findProfile(profileId, propertyId);
    const result = await this.db
      .delete(taxRules)
      .where(and(eq(taxRules.id, ruleId), eq(taxRules.taxProfileId, profileId)))
      .returning();
    if (result.length === 0) throw new NotFoundException(`Tax rule ${ruleId} not found`);
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Tax Calculation Engine
  // ---------------------------------------------------------------------------

  /**
   * Get the active tax profile for a property on a given date.
   * Returns profile with its active rules, sorted by sortOrder.
   */
  async getActiveTaxProfile(propertyId: string, date: string, db?: any) {
    const conn = db ?? this.db;
    const [profile] = await conn
      .select()
      .from(taxProfiles)
      .where(
        and(
          eq(taxProfiles.propertyId, propertyId),
          eq(taxProfiles.isActive, true),
          lte(taxProfiles.effectiveFrom, date),
          sql`(${taxProfiles.effectiveTo} is null or ${taxProfiles.effectiveTo} >= ${date})`,
        ),
      );

    if (!profile) return null;

    const rules = await conn
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxProfileId, profile.id),
          eq(taxRules.isActive, true),
          lte(taxRules.effectiveFrom, date),
          sql`(${taxRules.effectiveTo} is null or ${taxRules.effectiveTo} >= ${date})`,
        ),
      )
      .orderBy(taxRules.sortOrder);

    return { ...profile, rules };
  }

  /**
   * Calculate taxes for a charge.
   *
   * @param chargeAmount - base charge amount (string)
   * @param chargeType - charge type (e.g., 'room')
   * @param propertyId - property UUID
   * @param serviceDate - ISO date string
   * @param options - guest info, night counts for flat calculations
   */
  async calculateTaxes(
    chargeAmount: string,
    chargeType: string,
    propertyId: string,
    serviceDate: string,
    options?: {
      guestId?: string;
      numberOfNights?: number;
      nightNumber?: number;
    },
    db?: any,
  ): Promise<TaxLineItem[]> {
    const conn = db ?? this.db;
    const profile = await this.getActiveTaxProfile(
      propertyId,
      serviceDate.slice(0, 10),
      conn,
    );
    if (!profile || !profile.rules.length) return [];

    // Load guest if needed for exemption checks
    let guest: any = null;
    if (options?.guestId) {
      const [g] = await conn
        .select()
        .from(guests)
        .where(eq(guests.id, options.guestId));
      guest = g ?? null;
    }

    // Monetary math: use Decimal on string inputs to preserve precision
    // (numeric columns are strings in drizzle).
    const amount = new Decimal(chargeAmount);
    const items: TaxLineItem[] = [];
    let runningBase = amount;

    for (const rule of profile.rules) {
      // Check if rule applies to this charge type
      if (rule.appliesToChargeTypes && rule.appliesToChargeTypes.length > 0) {
        if (!rule.appliesToChargeTypes.includes(chargeType) && !rule.appliesToChargeTypes.includes('*')) {
          continue;
        }
      }

      // Check exemptions
      if (rule.exemptions) {
        const ex = rule.exemptions as { guestTypes?: string[]; minStayNights?: number; maxNights?: number };

        // Guest type exemption (e.g., government, military)
        if (ex.guestTypes && ex.guestTypes.length > 0 && guest) {
          if (ex.guestTypes.includes(guest.vipLevel)) continue;
        }

        // Min stay exemption (exempt if stay >= N nights)
        if (ex.minStayNights && options?.numberOfNights) {
          if (options.numberOfNights >= ex.minStayNights) continue;
        }

        // Max nights cap (only charge for first N nights)
        if (ex.maxNights && options?.nightNumber) {
          if (options.nightNumber > ex.maxNights) continue;
        }
      }

      // Calculate tax amount using Decimal arithmetic
      const rateValue = new Decimal(rule.rate);
      let taxAmount: Decimal;

      switch (rule.type) {
        case 'percentage': {
          const base = rule.isCompounding ? runningBase : amount;
          taxAmount = base.times(rateValue).div(100);
          break;
        }
        case 'split_component': {
          // Rate is applied only to `splitPercentage %` of the charge.
          // Compounding interacts the same way as percentage — if the rule is
          // compounding we still scale the (running) base by the split fraction
          // before applying the rate.
          const splitPct = rule.splitPercentage
            ? new Decimal(rule.splitPercentage)
            : new Decimal(0);
          const base = rule.isCompounding ? runningBase : amount;
          const taxableBase = base.times(splitPct).div(100);
          taxAmount = taxableBase.times(rateValue).div(100);
          break;
        }
        case 'flat_per_night':
          taxAmount = rateValue.times(options?.numberOfNights ?? 1);
          break;
        case 'flat_per_stay':
          taxAmount = rateValue;
          break;
        default:
          taxAmount = new Decimal(0);
      }

      // Round at the posting boundary to 2 decimals
      const taxAmountRounded = new Decimal(taxAmount.toFixed(2));

      if (taxAmountRounded.gt(0)) {
        items.push({
          name: rule.name,
          code: rule.code,
          type: rule.type,
          rate: rule.rate,
          amount: taxAmountRounded.toFixed(2),
          isCompounding: rule.isCompounding,
        });

        // Update running base for compounding
        runningBase = runningBase.plus(taxAmountRounded);
      }
    }

    return items;
  }

  /**
   * Back-calculate base amount from a tax-inclusive total.
   * Iterates percentage rules to find the effective total rate,
   * then: base = total / (1 + totalPercentageRate/100)
   * Flat taxes are subtracted from the total before percentage division.
   */
  async backCalculateFromInclusive(
    totalAmount: string,
    chargeType: string,
    propertyId: string,
    serviceDate: string,
    options?: { guestId?: string; numberOfNights?: number; nightNumber?: number },
  ): Promise<{ baseAmount: string; taxes: TaxLineItem[] }> {
    const profile = await this.getActiveTaxProfile(propertyId, serviceDate.slice(0, 10));
    if (!profile || !profile.rules.length) {
      return { baseAmount: totalAmount, taxes: [] };
    }

    // Monetary math: use Decimal on strings. Back-calc net from gross as
    //   net = (gross - flats) / (1 + totalPercentRate/100)
    const total = new Decimal(totalAmount);

    // Separate flat and percentage rules (simplified — ignores compounding for back-calc)
    let totalPercentageRate = new Decimal(0);
    let totalFlat = new Decimal(0);

    for (const rule of profile.rules) {
      if (rule.appliesToChargeTypes && rule.appliesToChargeTypes.length > 0) {
        if (!rule.appliesToChargeTypes.includes(chargeType) && !rule.appliesToChargeTypes.includes('*')) {
          continue;
        }
      }

      const rateValue = new Decimal(rule.rate);
      switch (rule.type) {
        case 'percentage':
          totalPercentageRate = totalPercentageRate.plus(rateValue);
          break;
        case 'split_component': {
          // Effective rate contribution is (splitPercentage/100) * rate.
          // Keep it in "percent" units (consistent with totalPercentageRate)
          // by multiplying rate by splitPercentage/100.
          const splitPct = rule.splitPercentage
            ? new Decimal(rule.splitPercentage)
            : new Decimal(0);
          totalPercentageRate = totalPercentageRate.plus(rateValue.times(splitPct).div(100));
          break;
        }
        case 'flat_per_night':
          totalFlat = totalFlat.plus(rateValue.times(options?.numberOfNights ?? 1));
          break;
        case 'flat_per_stay':
          totalFlat = totalFlat.plus(rateValue);
          break;
      }
    }

    const afterFlat = total.minus(totalFlat);
    const divisor = new Decimal(1).plus(totalPercentageRate.div(100));
    const baseAmount = afterFlat.div(divisor);
    const baseStr = baseAmount.toFixed(2);

    // Recalculate forward to get exact tax line items
    const taxes = await this.calculateTaxes(baseStr, chargeType, propertyId, serviceDate, options);

    return { baseAmount: baseStr, taxes };
  }
}
