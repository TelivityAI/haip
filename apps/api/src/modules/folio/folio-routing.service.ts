import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, inArray, desc } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  folios,
  charges,
  reservations,
  payments,
  folioRoutingRules,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from './folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { TransferCityLedgerDto } from './dto/transfer-city-ledger.dto';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { MoveTransactionsDto } from './dto/move-transactions.dto';
import type { CreateChargeDto } from './dto/create-charge.dto';

@Injectable()
export class FolioRoutingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly folioService: FolioService,
    private readonly webhookService: WebhookService,
  ) {}

  async routeCharge(
    reservationId: string,
    propertyId: string,
    chargeType: string,
    chargeDto: CreateChargeDto,
  ) {
    const targetFolioId = await this.resolveTargetFolio(
      reservationId,
      propertyId,
      chargeType,
    );
    return this.folioService.postCharge(targetFolioId, chargeDto);
  }

  /**
   * Resolve which folio a charge of `chargeType` should post to for a given
   * reservation (KB 14.2). Configured `folio_routing_rules` (highest priority
   * first) win; otherwise fall back to legacy reservation-preference routing,
   * then the default guest folio.
   */
  async resolveTargetFolio(
    reservationId: string,
    propertyId: string,
    chargeType: string,
  ): Promise<string> {
    const rules = await this.db
      .select()
      .from(folioRoutingRules)
      .where(
        and(
          eq(folioRoutingRules.reservationId, reservationId),
          eq(folioRoutingRules.propertyId, propertyId),
          eq(folioRoutingRules.chargeType, chargeType as any),
        ),
      )
      .orderBy(desc(folioRoutingRules.priority));
    if (rules.length > 0) {
      return rules[0].targetFolioId;
    }

    // Legacy fallback: routing map stored on reservation preferences.
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.propertyId, propertyId),
        ),
      );
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    const routing = reservation.preferences?.routing as Record<string, string> | undefined;
    if (routing) {
      const fromPrefs = routing[chargeType] ?? routing['default'] ?? null;
      if (fromPrefs) return fromPrefs;
    }

    const defaultFolio = await this.findDefaultFolio(reservationId, propertyId);
    return defaultFolio.id;
  }

  async createRoutingRule(propertyId: string, dto: CreateRoutingRuleDto) {
    // Validate that both reservation and target folio belong to this property
    // (no confused-deputy: propertyId comes from the request, not derived).
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.id, dto.reservationId), eq(reservations.propertyId, propertyId)),
      );
    if (!reservation) {
      throw new NotFoundException(`Reservation ${dto.reservationId} not found`);
    }
    await this.folioService.findById(dto.targetFolioId, propertyId);

    const [rule] = await this.db
      .insert(folioRoutingRules)
      .values({
        propertyId,
        reservationId: dto.reservationId,
        chargeType: dto.chargeType as any,
        targetFolioId: dto.targetFolioId,
        priority: dto.priority ?? 0,
      })
      .returning();

    await this.webhookService.emit(
      'folio.routing_rule_created',
      'folio_routing_rule',
      rule.id,
      {
        reservationId: rule.reservationId,
        chargeType: rule.chargeType,
        targetFolioId: rule.targetFolioId,
        priority: rule.priority,
      },
      propertyId,
    );

    return rule;
  }

  async listRoutingRules(reservationId: string, propertyId: string) {
    return this.db
      .select()
      .from(folioRoutingRules)
      .where(
        and(
          eq(folioRoutingRules.reservationId, reservationId),
          eq(folioRoutingRules.propertyId, propertyId),
        ),
      )
      .orderBy(desc(folioRoutingRules.priority));
  }

  /**
   * Move transactions between folios (KB 14.2) — by single charge id or by
   * charge type. Locked (night-audited) charges cannot move; the whole move is
   * rejected if any matching charge is locked. Both folios are locked
   * FOR UPDATE in deterministic id order to avoid deadlocks, mirroring
   * FolioService.transferCharge.
   */
  async moveTransactions(
    propertyId: string,
    fromFolioId: string,
    toFolioId: string,
    opts: { chargeId?: string; chargeType?: string },
  ) {
    if (!opts.chargeId && !opts.chargeType) {
      throw new BadRequestException('Provide either chargeId or chargeType to move');
    }
    if (fromFolioId === toFolioId) {
      throw new BadRequestException('Source and destination folios must differ');
    }

    const { moved } = await this.db.transaction(async (tx: any) => {
      // Lock both folios (deterministic order by id to avoid deadlock)
      const [firstId, secondId] = [fromFolioId, toFolioId].sort();

      const [firstFolio] = await tx
        .select()
        .from(folios)
        .where(and(eq(folios.id, firstId!), eq(folios.propertyId, propertyId)))
        .for('update');
      if (!firstFolio) {
        throw new NotFoundException(`Folio ${firstId} not found`);
      }
      const [secondFolio] = await tx
        .select()
        .from(folios)
        .where(and(eq(folios.id, secondId!), eq(folios.propertyId, propertyId)))
        .for('update');
      if (!secondFolio) {
        throw new NotFoundException(`Folio ${secondId} not found`);
      }

      const sourceFolio = firstFolio.id === fromFolioId ? firstFolio : secondFolio;
      const targetFolio = firstFolio.id === toFolioId ? firstFolio : secondFolio;

      if (sourceFolio.status !== 'open') {
        throw new BadRequestException('Source folio is not open');
      }
      if (targetFolio.status !== 'open') {
        throw new BadRequestException('Target folio is not open');
      }

      const conditions: any[] = [
        eq(charges.folioId, fromFolioId),
        eq(charges.propertyId, propertyId),
      ];
      if (opts.chargeId) conditions.push(eq(charges.id, opts.chargeId));
      if (opts.chargeType) conditions.push(eq(charges.type, opts.chargeType as any));

      const matching = await tx
        .select()
        .from(charges)
        .where(and(...conditions));

      if (matching.length === 0) {
        throw new NotFoundException('No matching charges found on the source folio');
      }
      if (matching.some((c: any) => c.isLocked)) {
        throw new BadRequestException('Cannot move locked (night-audited) charges');
      }

      const ids = matching.map((c: any) => c.id);
      await tx
        .update(charges)
        .set({ folioId: toFolioId })
        .where(inArray(charges.id, ids));

      await this.folioService.recalculateBalance(fromFolioId, propertyId, tx);
      await this.folioService.recalculateBalance(toFolioId, propertyId, tx);

      return { moved: ids.length };
    });

    // Emit AFTER commit
    await this.webhookService.emit(
      'folio.transactions_moved',
      'folio',
      toFolioId,
      { fromFolioId, toFolioId, moved },
      propertyId,
    );

    return { moved };
  }

  async findDefaultFolio(reservationId: string, propertyId: string) {
    const [folio] = await this.db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.reservationId, reservationId),
          eq(folios.propertyId, propertyId),
          eq(folios.type, 'guest'),
        ),
      );
    if (!folio) {
      throw new NotFoundException(
        `No guest folio found for reservation ${reservationId}`,
      );
    }
    return folio;
  }

  async transferToCityLedger(
    folioId: string,
    propertyId: string,
    dto: TransferCityLedgerDto,
  ) {
    const result = await this.db.transaction(async (tx: any) => {
      const [sourceFolio] = await tx
        .select()
        .from(folios)
        .where(and(eq(folios.id, folioId), eq(folios.propertyId, propertyId)))
        .for('update');

      if (!sourceFolio) {
        throw new NotFoundException(`Folio ${folioId} not found`);
      }

      await this.folioService.recalculateBalance(folioId, propertyId, tx);

      const [refreshed] = await tx
        .select()
        .from(folios)
        .where(and(eq(folios.id, folioId), eq(folios.propertyId, propertyId)));

      const remainingBalance = new Decimal(refreshed?.balance ?? '0');

      if (remainingBalance.lte(0)) {
        return { message: 'No outstanding balance to transfer' as const };
      }

      const amountStr = remainingBalance.toFixed(2);

      const cityLedgerFolio = await this.folioService.create(
        {
          propertyId,
          guestId: sourceFolio.guestId,
          type: 'city_ledger',
          currencyCode: sourceFolio.currencyCode,
          companyName: dto.companyName,
          billingAddress: dto.billingAddress,
          paymentTermsDays: dto.paymentTermsDays,
        },
        tx,
      );

      await tx
        .insert(payments)
        .values({
          folioId,
          propertyId,
          method: 'city_ledger',
          amount: amountStr,
          currencyCode: sourceFolio.currencyCode,
          status: 'captured',
          processedAt: new Date(),
          notes: `Transferred to city ledger: ${dto.companyName}`,
        });

      await this.folioService.recalculateBalance(folioId, propertyId, tx);

      await this.folioService.postCharge(
        cityLedgerFolio.id,
        {
          propertyId,
          type: 'fee',
          description: `Transfer from folio ${sourceFolio.folioNumber}`,
          amount: amountStr,
          currencyCode: sourceFolio.currencyCode,
          serviceDate: new Date().toISOString(),
        },
        tx,
      );

      return {
        cityLedgerFolio,
        amountStr,
        sourceFolioId: folioId,
      };
    });

    if ('message' in result) {
      return result;
    }

    return {
      sourceFolioId: result.sourceFolioId,
      cityLedgerFolioId: result.cityLedgerFolio.id,
      transferredAmount: result.amountStr,
    };
  }
}
