// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject } from '@nestjs/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { ratePlans, channelConnections } from '@inhotel-io/database';
import { DRIZZLE } from '../../database/database.module';

export interface RateParityResult {
  ratePlanId: string;
  ratePlanName: string;
  baseAmount: number;
  channels: Array<{
    channelConnectionId: string;
    channelCode: string;
    channelName: string;
    channelRateCode: string;
    effectiveRate: number;
    hasOverride: boolean;
    isParity: boolean;
    variance: number;
  }>;
  parityViolations: number;
}

export interface RateOverride {
  channelConnectionId: string;
  ratePlanId: string;
  adjustmentType: 'percentage' | 'fixed';
  adjustmentValue: number;
  startDate?: string;
  endDate?: string;
  reason?: string;
}

@Injectable()
export class RateParityService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Check rate parity across all active channels for a property (KB 6.1).
   * Compares base rate plan amounts against what each channel is configured to receive.
   */
  async checkParity(propertyId: string, ratePlanId?: string): Promise<RateParityResult[]> {
    // Get rate plans
    const ratePlanConditions = [eq(ratePlans.propertyId, propertyId), eq(ratePlans.isActive, true)];
    if (ratePlanId) {
      ratePlanConditions.push(eq(ratePlans.id, ratePlanId));
    }

    const plans = await this.db
      .select()
      .from(ratePlans)
      .where(and(...ratePlanConditions));

    // Get active channel connections
    const connections = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.propertyId, propertyId),
          eq(channelConnections.status, 'active' as any),
          eq(channelConnections.isActive, true),
        ),
      );

    const results: RateParityResult[] = [];

    for (const plan of plans) {
      const baseAmount = new Decimal(plan.baseAmount).toNumber();
      const channels: RateParityResult['channels'] = [];
      let parityViolations = 0;

      for (const conn of connections) {
        const ratePlanMapping = (conn.ratePlanMapping ?? []) as Array<{
          ratePlanId: string;
          channelRateCode: string;
        }>;

        const mapping = ratePlanMapping.find((m) => m.ratePlanId === plan.id);
        if (!mapping) continue;

        // Check for rate overrides in connection config
        const config = (conn.config ?? {}) as Record<string, unknown>;
        const overrides = (config['rateOverrides'] as RateOverride[] | undefined) ?? [];
        const override = overrides.find((o) => o.ratePlanId === plan.id);

        let effectiveRateDec = new Decimal(baseAmount);
        let hasOverride = false;

        if (override) {
          hasOverride = true;
          effectiveRateDec = this.applyOverrideDecimal(effectiveRateDec, override);
        }

        const varianceDec = effectiveRateDec.minus(baseAmount).abs();
        const isParity = varianceDec.lt('0.01'); // Within 1 cent tolerance

        if (!isParity) {
          parityViolations++;
        }

        channels.push({
          channelConnectionId: conn.id,
          channelCode: conn.channelCode,
          channelName: conn.channelName,
          channelRateCode: mapping.channelRateCode,
          effectiveRate: Number(effectiveRateDec.toFixed(2)),
          hasOverride,
          isParity,
          variance: Number(varianceDec.toFixed(2)),
        });
      }

      results.push({
        ratePlanId: plan.id,
        ratePlanName: plan.name,
        baseAmount,
        channels,
        parityViolations,
      });
    }

    return results;
  }

  /**
   * Get the effective rate for a specific rate plan on a specific channel,
   * applying any overrides or fenced rate rules.
   */
  async getEffectiveRate(
    propertyId: string,
    ratePlanId: string,
    channelConnectionId: string,
    date?: string,
  ): Promise<{ baseAmount: number; effectiveRate: number; hasOverride: boolean; override?: RateOverride }> {
    const [plan] = await this.db
      .select()
      .from(ratePlans)
      .where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.propertyId, propertyId)));

    if (!plan) {
      return { baseAmount: 0, effectiveRate: 0, hasOverride: false };
    }

    const [conn] = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.id, channelConnectionId),
          eq(channelConnections.propertyId, propertyId),
        ),
      );

    if (!conn) {
      const base = new Decimal(plan.baseAmount).toNumber();
      return { baseAmount: base, effectiveRate: base, hasOverride: false };
    }

    const baseAmount = new Decimal(plan.baseAmount).toNumber();
    const config = (conn.config ?? {}) as Record<string, unknown>;
    const overrides = (config['rateOverrides'] as RateOverride[] | undefined) ?? [];

    // Find applicable override (date-specific first, then general)
    const applicableOverride = this.findApplicableOverride(overrides, ratePlanId, date);

    if (!applicableOverride) {
      return { baseAmount, effectiveRate: baseAmount, hasOverride: false };
    }

    const effectiveRateDec = this.applyOverrideDecimal(new Decimal(baseAmount), applicableOverride);
    return {
      baseAmount,
      effectiveRate: Number(effectiveRateDec.toFixed(2)),
      hasOverride: true,
      override: applicableOverride,
    };
  }

  /**
   * Set a rate override for a specific channel + rate plan combination.
   * Stored in the channel connection's config.rateOverrides array.
   */
  async setRateOverride(
    channelConnectionId: string,
    propertyId: string,
    override: RateOverride,
  ) {
    const [conn] = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.id, channelConnectionId),
          eq(channelConnections.propertyId, propertyId),
        ),
      );

    if (!conn) {
      throw new Error(`Channel connection ${channelConnectionId} not found`);
    }

    const config = (conn.config ?? {}) as Record<string, unknown>;
    const overrides = (config['rateOverrides'] as RateOverride[] | undefined) ?? [];

    // Remove existing override for same ratePlan + date range
    const filtered = overrides.filter(
      (o) =>
        !(
          o.ratePlanId === override.ratePlanId &&
          o.startDate === override.startDate &&
          o.endDate === override.endDate
        ),
    );

    filtered.push(override);
    config['rateOverrides'] = filtered;

    await this.db
      .update(channelConnections)
      .set({ config, updatedAt: new Date() })
      .where(eq(channelConnections.id, channelConnectionId));

    return override;
  }

  /**
   * Remove a rate override.
   */
  async removeRateOverride(
    channelConnectionId: string,
    propertyId: string,
    ratePlanId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const [conn] = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.id, channelConnectionId),
          eq(channelConnections.propertyId, propertyId),
        ),
      );

    if (!conn) {
      throw new Error(`Channel connection ${channelConnectionId} not found`);
    }

    const config = (conn.config ?? {}) as Record<string, unknown>;
    const overrides = (config['rateOverrides'] as RateOverride[] | undefined) ?? [];

    const filtered = overrides.filter(
      (o) =>
        !(
          o.ratePlanId === ratePlanId &&
          o.startDate === startDate &&
          o.endDate === endDate
        ),
    );

    config['rateOverrides'] = filtered;

    await this.db
      .update(channelConnections)
      .set({ config, updatedAt: new Date() })
      .where(eq(channelConnections.id, channelConnectionId));

    return { removed: overrides.length - filtered.length };
  }

  // --- Private Helpers ---

  private applyOverride(baseAmount: number, override: RateOverride): number {
    return this.applyOverrideDecimal(new Decimal(baseAmount), override).toNumber();
  }

  // Decimal-safe override math — preferred internally to avoid float drift on
  // percentage adjustments (e.g. 10% of 127.35 drifts under JS multiply).
  private applyOverrideDecimal(baseAmount: Decimal, override: RateOverride): Decimal {
    if (override.adjustmentType === 'percentage') {
      return baseAmount.times(new Decimal(1).plus(new Decimal(override.adjustmentValue).div(100)));
    }
    // Fixed adjustment
    return baseAmount.plus(override.adjustmentValue);
  }

  private findApplicableOverride(
    overrides: RateOverride[],
    ratePlanId: string,
    date?: string,
  ): RateOverride | undefined {
    const matching = overrides.filter((o) => o.ratePlanId === ratePlanId);

    if (date) {
      // Date-specific override takes precedence
      const dateSpecific = matching.find(
        (o) => o.startDate && o.endDate && o.startDate <= date && o.endDate >= date,
      );
      if (dateSpecific) return dateSpecific;
    }

    // General override (no date range)
    return matching.find((o) => !o.startDate && !o.endDate);
  }
}
