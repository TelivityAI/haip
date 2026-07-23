import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { cancellationPolicies, ratePlans } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { CreateCancellationPolicyDto } from './dto/create-cancellation-policy.dto';
import { UpdateCancellationPolicyDto } from './dto/update-cancellation-policy.dto';
import { ListCancellationPoliciesDto } from './dto/list-cancellation-policies.dto';

export type DepositAction = 'refund' | 'forfeit';

export interface CancellationEvaluation {
  withinFreeWindow: boolean;
  penaltyAmount: string;
  depositAction: DepositAction;
  policyDescription: string;
  policyId: string | null;
  policyCode: string | null;
  penaltyType: string;
}

export interface EvaluateCancellationInput {
  propertyId: string;
  ratePlanId: string;
  arrivalDate: string;
  totalAmount: string | number;
  nights: number;
  now?: Date;
}

/** Default when a rate plan has no linked cancellation policy (matches prior Connect heuristic). */
const DEFAULT_POLICY = {
  id: null as string | null,
  code: null as string | null,
  description: 'Free cancellation up to 24 hours before check-in. First night charge after.',
  freeCancelHoursBeforeArrival: 24,
  penaltyType: 'first_night' as const,
  penaltyPercentage: null as string | null,
  depositHandling: 'refund_if_refundable' as const,
};

@Injectable()
export class PolicyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  async create(dto: CreateCancellationPolicyDto) {
    this.assertPercentage(dto.penaltyType, dto.penaltyPercentage);
    const [row] = await this.db
      .insert(cancellationPolicies)
      .values({
        propertyId: dto.propertyId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        freeCancelHoursBeforeArrival: dto.freeCancelHoursBeforeArrival ?? 24,
        penaltyType: dto.penaltyType ?? 'first_night',
        penaltyPercentage: dto.penaltyPercentage,
        depositHandling: dto.depositHandling ?? 'refund_if_refundable',
        isActive: dto.isActive ?? true,
      })
      .returning();

    await this.webhookService.emit(
      'cancellation_policy.created',
      'cancellation_policy',
      row.id,
      { code: row.code, name: row.name, penaltyType: row.penaltyType },
      row.propertyId,
    );
    return row;
  }

  async findById(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(cancellationPolicies)
      .where(
        and(eq(cancellationPolicies.id, id), eq(cancellationPolicies.propertyId, propertyId)),
      );
    if (!row) {
      throw new NotFoundException(`Cancellation policy ${id} not found`);
    }
    return row;
  }

  async list(dto: ListCancellationPoliciesDto) {
    const conditions: any[] = [eq(cancellationPolicies.propertyId, dto.propertyId)];
    if (dto.isActive !== undefined) {
      conditions.push(eq(cancellationPolicies.isActive, dto.isActive === 'true'));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(cancellationPolicies)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(cancellationPolicies.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(cancellationPolicies)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async update(id: string, propertyId: string, dto: UpdateCancellationPolicyDto) {
    const existing = await this.findById(id, propertyId);
    const penaltyType = dto.penaltyType ?? existing.penaltyType;
    const penaltyPercentage =
      dto.penaltyPercentage !== undefined ? dto.penaltyPercentage : existing.penaltyPercentage;
    this.assertPercentage(penaltyType, penaltyPercentage ?? undefined);

    const [updated] = await this.db
      .update(cancellationPolicies)
      .set({ ...dto, updatedAt: new Date() })
      .where(
        and(eq(cancellationPolicies.id, id), eq(cancellationPolicies.propertyId, propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'cancellation_policy.updated',
      'cancellation_policy',
      updated.id,
      { code: updated.code, name: updated.name },
      updated.propertyId,
    );
    return updated;
  }

  async softDelete(id: string, propertyId: string) {
    await this.findById(id, propertyId);
    const [updated] = await this.db
      .update(cancellationPolicies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(eq(cancellationPolicies.id, id), eq(cancellationPolicies.propertyId, propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'cancellation_policy.deleted',
      'cancellation_policy',
      updated.id,
      { code: updated.code },
      updated.propertyId,
    );
    return updated;
  }

  /**
   * Resolve the linked policy for a rate plan (property-scoped), or the default heuristic.
   */
  async resolvePolicyForRatePlan(propertyId: string, ratePlanId: string) {
    const [ratePlan] = await this.db
      .select()
      .from(ratePlans)
      .where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.propertyId, propertyId)));
    if (!ratePlan) {
      throw new NotFoundException(`Rate plan ${ratePlanId} not found`);
    }

    if (ratePlan.cancellationPolicyId) {
      const [policy] = await this.db
        .select()
        .from(cancellationPolicies)
        .where(
          and(
            eq(cancellationPolicies.id, ratePlan.cancellationPolicyId),
            eq(cancellationPolicies.propertyId, propertyId),
            eq(cancellationPolicies.isActive, true),
          ),
        );
      if (policy) {
        return { ratePlan, policy };
      }
    }

    return { ratePlan, policy: null };
  }

  /** Guest-facing summary for search / quote / book responses. */
  async getPolicySummary(propertyId: string, ratePlanId: string) {
    const { policy } = await this.resolvePolicyForRatePlan(propertyId, ratePlanId);
    const p = policy ?? DEFAULT_POLICY;
    const type =
      p.penaltyType === 'full' && (p.freeCancelHoursBeforeArrival ?? 0) === 0
        ? 'non_refundable'
        : 'tiered';
    return {
      type,
      penaltyType: p.penaltyType,
      description:
        p.description ??
        this.formatDescription(
          p.freeCancelHoursBeforeArrival ?? 24,
          p.penaltyType,
          p.penaltyPercentage,
        ),
      freeCancelHoursBeforeArrival: p.freeCancelHoursBeforeArrival ?? 24,
      policyId: p.id,
      policyCode: 'code' in p ? p.code : null,
    };
  }

  async evaluateCancellation(input: EvaluateCancellationInput): Promise<CancellationEvaluation> {
    const { propertyId, ratePlanId, arrivalDate, totalAmount, nights } = input;
    const now = input.now ?? new Date();
    const { policy } = await this.resolvePolicyForRatePlan(propertyId, ratePlanId);
    const p = policy ?? DEFAULT_POLICY;

    const freeHours = p.freeCancelHoursBeforeArrival ?? 24;
    // Align with prior Connect heuristic: arrival day at 15:00 UTC as check-in anchor.
    const checkInAt = new Date(`${arrivalDate}T15:00:00Z`);
    const hoursUntilCheckIn = (checkInAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    // freeHours === 0 means there is never a free-cancel window (non-refundable).
    const withinFreeWindow = freeHours > 0 && hoursUntilCheckIn >= freeHours;

    const totalDec = new Decimal(totalAmount);
    let penaltyAmount = new Decimal(0);

    if (!withinFreeWindow) {
      switch (p.penaltyType) {
        case 'none':
          penaltyAmount = new Decimal(0);
          break;
        case 'first_night': {
          const n = nights > 0 ? nights : 1;
          penaltyAmount = totalDec.div(n);
          break;
        }
        case 'percentage': {
          const pct = new Decimal(p.penaltyPercentage ?? 0).div(100);
          penaltyAmount = totalDec.times(pct);
          break;
        }
        case 'full':
          penaltyAmount = totalDec;
          break;
        default:
          penaltyAmount = new Decimal(0);
      }
    }

    const depositAction = this.resolveDepositAction(
      p.depositHandling,
      withinFreeWindow,
    );

    const policyDescription =
      p.description ??
      this.formatDescription(freeHours, p.penaltyType, p.penaltyPercentage);

    return {
      withinFreeWindow,
      penaltyAmount: penaltyAmount.toFixed(2),
      depositAction,
      policyDescription,
      policyId: p.id,
      policyCode: 'code' in p ? (p.code as string | null) : null,
      penaltyType: p.penaltyType,
    };
  }

  private resolveDepositAction(
    handling: string,
    withinFreeWindow: boolean,
  ): DepositAction {
    if (handling === 'always_forfeit') return 'forfeit';
    if (handling === 'always_refund') return 'refund';
    // refund_if_refundable
    return withinFreeWindow ? 'refund' : 'forfeit';
  }

  private assertPercentage(penaltyType?: string, penaltyPercentage?: string) {
    if (penaltyType === 'percentage') {
      if (penaltyPercentage === undefined || penaltyPercentage === null || penaltyPercentage === '') {
        throw new BadRequestException('penaltyPercentage is required when penaltyType is percentage');
      }
      const n = Number(penaltyPercentage);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        throw new BadRequestException('penaltyPercentage must be between 0 and 100');
      }
    }
  }

  private formatDescription(
    freeHours: number,
    penaltyType: string,
    penaltyPercentage: string | null | undefined,
  ): string {
    if (penaltyType === 'full' && freeHours === 0) {
      return 'Non-refundable — full charge applies on cancel or no-show.';
    }
    const penaltyLabel =
      penaltyType === 'first_night'
        ? 'First night charge'
        : penaltyType === 'percentage'
          ? `${penaltyPercentage ?? 0}% charge`
          : penaltyType === 'full'
            ? 'Full charge'
            : 'No penalty';
    return `Free cancellation up to ${freeHours} hours before check-in. ${penaltyLabel} after.`;
  }
}
