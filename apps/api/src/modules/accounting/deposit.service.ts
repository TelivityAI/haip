import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { depositLedgerEntries } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { ListDepositsDto } from './dto/list-deposits.dto';
import { ApplyDepositDto } from './dto/apply-deposit.dto';

/**
 * Deposit Ledger service (KB 10).
 *
 * Advance deposits are a LIABILITY, not revenue (KB 10.1). A deposit is created
 * in the `held` state and is only recognized when applied to a folio (check-in /
 * checkout — KB 10.3) or forfeited as earned revenue (non-refundable cancel /
 * no-show — KB 10.4). Refundable deposits may be refunded while still held.
 *
 * State machine (KB 10.3/10.4): only a `held` deposit may transition to
 * `applied`, `refunded`, or `forfeited`. Those are terminal.
 */
@Injectable()
export class DepositService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly folioService: FolioService,
  ) {}

  async recordDeposit(dto: RecordDepositDto) {
    const [entry] = await this.db
      .insert(depositLedgerEntries)
      .values({
        propertyId: dto.propertyId,
        reservationId: dto.reservationId,
        paymentId: dto.paymentId,
        amount: new Decimal(dto.amount).toFixed(2),
        currencyCode: dto.currencyCode,
        status: 'held',
        isRefundable: dto.isRefundable ?? true,
        notes: dto.notes,
      })
      .returning();

    await this.webhookService.emit(
      'deposit.received',
      'deposit',
      entry.id,
      { amount: entry.amount, status: entry.status, isRefundable: entry.isRefundable },
      entry.propertyId,
    );
    return entry;
  }

  async findById(id: string, propertyId: string) {
    const [entry] = await this.db
      .select()
      .from(depositLedgerEntries)
      .where(
        and(eq(depositLedgerEntries.id, id), eq(depositLedgerEntries.propertyId, propertyId)),
      );
    if (!entry) {
      throw new NotFoundException(`Deposit ${id} not found`);
    }
    return entry;
  }

  async list(dto: ListDepositsDto) {
    const conditions: any[] = [eq(depositLedgerEntries.propertyId, dto.propertyId)];
    if (dto.reservationId) {
      conditions.push(eq(depositLedgerEntries.reservationId, dto.reservationId));
    }
    if (dto.status) {
      conditions.push(
        eq(depositLedgerEntries.status, dto.status as 'held' | 'applied' | 'refunded' | 'forfeited'),
      );
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(depositLedgerEntries)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(depositLedgerEntries.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(depositLedgerEntries)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  /**
   * Apply a held deposit to the reservation folio (KB 10.3). Posts a credit
   * (negative adjustment charge) to the folio, offsetting actual charges, then
   * marks the deposit `applied` and stamps `recognizedAt`.
   */
  async applyDeposit(id: string, dto: ApplyDepositDto) {
    const entry = await this.findById(id, dto.propertyId);
    if (entry.status !== 'held') {
      throw new BadRequestException(
        `Only a held deposit can be applied (current: ${entry.status})`,
      );
    }

    const folioId = dto.folioId;
    if (folioId) {
      // Post the deposit to the guest ledger as a negative adjustment so the
      // folio balance is reduced by the deposit amount (KB 10.3).
      await this.folioService.postCharge(folioId, {
        propertyId: dto.propertyId,
        type: 'adjustment',
        description: 'Deposit applied',
        amount: new Decimal(entry.amount).negated().toFixed(2),
        currencyCode: entry.currencyCode,
        serviceDate: new Date().toISOString(),
        skipTaxCalculation: true,
      });
    }

    const [updated] = await this.db
      .update(depositLedgerEntries)
      .set({ status: 'applied', recognizedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(depositLedgerEntries.id, id), eq(depositLedgerEntries.propertyId, dto.propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'deposit.applied',
      'deposit',
      updated.id,
      { amount: updated.amount, folioId: folioId ?? null },
      updated.propertyId,
    );
    return updated;
  }

  /**
   * Refund a held, refundable deposit (KB 10.4). Clears the liability.
   */
  async refundDeposit(id: string, propertyId: string) {
    const entry = await this.findById(id, propertyId);
    if (entry.status !== 'held') {
      throw new BadRequestException(
        `Only a held deposit can be refunded (current: ${entry.status})`,
      );
    }
    if (!entry.isRefundable) {
      throw new BadRequestException('Deposit is non-refundable and cannot be refunded');
    }

    const [updated] = await this.db
      .update(depositLedgerEntries)
      .set({ status: 'refunded', recognizedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(depositLedgerEntries.id, id), eq(depositLedgerEntries.propertyId, propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'deposit.refunded',
      'deposit',
      updated.id,
      { amount: updated.amount },
      updated.propertyId,
    );
    return updated;
  }

  /**
   * Forfeit a held deposit (non-refundable cancel / no-show), recognizing it as
   * earned revenue (KB 10.4).
   */
  async forfeitDeposit(id: string, propertyId: string) {
    const entry = await this.findById(id, propertyId);
    if (entry.status !== 'held') {
      throw new BadRequestException(
        `Only a held deposit can be forfeited (current: ${entry.status})`,
      );
    }

    const [updated] = await this.db
      .update(depositLedgerEntries)
      .set({ status: 'forfeited', recognizedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(depositLedgerEntries.id, id), eq(depositLedgerEntries.propertyId, propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'deposit.forfeited',
      'deposit',
      updated.id,
      { amount: updated.amount },
      updated.propertyId,
    );
    return updated;
  }
}
