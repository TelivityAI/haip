import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { arLedgers, arTransactions } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { CreateArLedgerDto } from './dto/create-ar-ledger.dto';
import { UpdateArLedgerDto } from './dto/update-ar-ledger.dto';
import { ListArLedgersDto } from './dto/list-ar-ledgers.dto';
import { TransferToArDto } from './dto/transfer-to-ar.dto';
import { RecordArPaymentDto } from './dto/record-ar-payment.dto';

/**
 * Accounts Receivable (A/R) service (KB 11).
 *
 * Named A/R ledgers (KB 11.2) with a formal transfer-to-zero workflow (KB 11.3),
 * reverse transfer (KB 11.4), payments and aging (KB 11.5). Transfers reuse
 * FolioService to post the offsetting adjustment so the source folio reaches a
 * zero balance — a ledger move, not a payment (KB 11.3).
 */
@Injectable()
export class ArService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly folioService: FolioService,
  ) {}

  async createLedger(dto: CreateArLedgerDto) {
    const [ledger] = await this.db
      .insert(arLedgers)
      .values({
        propertyId: dto.propertyId,
        name: dto.name,
        description: dto.description,
        paymentTermsDays: dto.paymentTermsDays,
        currencyCode: dto.currencyCode,
        status: 'open',
        balance: '0.00',
      })
      .returning();

    await this.webhookService.emit(
      'ar.ledger_created',
      'ar_ledger',
      ledger.id,
      { name: ledger.name, currencyCode: ledger.currencyCode },
      ledger.propertyId,
    );
    return ledger;
  }

  async findLedgerById(id: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [ledger] = await db
      .select()
      .from(arLedgers)
      .where(and(eq(arLedgers.id, id), eq(arLedgers.propertyId, propertyId)));
    if (!ledger) {
      throw new NotFoundException(`A/R ledger ${id} not found`);
    }
    return ledger;
  }

  async listLedgers(dto: ListArLedgersDto) {
    const conditions: any[] = [eq(arLedgers.propertyId, dto.propertyId)];
    if (dto.status) {
      conditions.push(eq(arLedgers.status, dto.status as 'open' | 'closed'));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(arLedgers)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(arLedgers.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(arLedgers)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async updateLedger(id: string, propertyId: string, dto: UpdateArLedgerDto) {
    await this.findLedgerById(id, propertyId);
    const [updated] = await this.db
      .update(arLedgers)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(arLedgers.id, id), eq(arLedgers.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async closeLedger(id: string, propertyId: string) {
    const ledger = await this.findLedgerById(id, propertyId);
    if (ledger.status === 'closed') {
      throw new BadRequestException('A/R ledger is already closed');
    }
    const [updated] = await this.db
      .update(arLedgers)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(and(eq(arLedgers.id, id), eq(arLedgers.propertyId, propertyId)))
      .returning();
    return updated;
  }

  /** List transactions on an A/R ledger (newest first). */
  async listTransactions(arLedgerId: string, propertyId: string) {
    await this.findLedgerById(arLedgerId, propertyId);
    const data = await this.db
      .select()
      .from(arTransactions)
      .where(
        and(
          eq(arTransactions.arLedgerId, arLedgerId),
          eq(arTransactions.propertyId, propertyId),
        ),
      )
      .orderBy(sql`${arTransactions.createdAt} desc`);
    return { data, total: data.length };
  }

  /**
   * Transfer an outstanding folio balance into an A/R ledger (KB 11.3).
   * The folio balance is reduced to 0.00 by posting an offsetting adjustment
   * (a ledger move, not a payment), a `transfer_in` txn is recorded, and the
   * ledger balance is bumped.
   */
  async transferFolioToAR(dto: TransferToArDto) {
    return this.db.transaction(async (tx: any) => {
      const folio = await this.folioService.findById(dto.folioId, dto.propertyId, tx);
      const ledger = await this.findLedgerById(dto.arLedgerId, dto.propertyId, tx);
      if (ledger.status !== 'open') {
        throw new BadRequestException('Cannot transfer into a closed A/R ledger');
      }

      const balance = new Decimal(folio.balance);
      if (balance.eq(0)) {
        throw new BadRequestException('Folio has no outstanding balance to transfer');
      }

      // Zero the folio by posting an offsetting adjustment (KB 11.3).
      await this.folioService.postCharge(
        dto.folioId,
        {
          propertyId: dto.propertyId,
          type: 'adjustment',
          description: `Transfer to A/R ledger ${ledger.name}`,
          amount: balance.negated().toFixed(2),
          currencyCode: folio.currencyCode,
          serviceDate: new Date().toISOString(),
          skipTaxCalculation: true,
        },
        tx,
      );

      const [txn] = await tx
        .insert(arTransactions)
        .values({
          propertyId: dto.propertyId,
          arLedgerId: dto.arLedgerId,
          type: 'transfer_in',
          amount: balance.toFixed(2),
          currencyCode: folio.currencyCode,
          sourceFolioId: dto.folioId,
          note: dto.note,
          createdBy: dto.createdBy,
        })
        .returning();

      const newLedgerBalance = new Decimal(ledger.balance).plus(balance).toFixed(2);
      await tx
        .update(arLedgers)
        .set({ balance: newLedgerBalance, updatedAt: new Date() })
        .where(and(eq(arLedgers.id, dto.arLedgerId), eq(arLedgers.propertyId, dto.propertyId)));

      await this.webhookService.emit(
        'ar.transfer_created',
        'ar_transaction',
        txn.id,
        { arLedgerId: dto.arLedgerId, folioId: dto.folioId, amount: txn.amount },
        dto.propertyId,
      );
      return txn;
    });
  }

  /**
   * Reverse a transfer-to-A/R (KB 11.4). Restores the source folio balance,
   * records a `reverse_transfer` txn, links the original via `reversedById`,
   * and decrements the ledger balance. No destructive edits.
   */
  async reverseTransfer(arTxnId: string, propertyId: string) {
    return this.db.transaction(async (tx: any) => {
      const [original] = await tx
        .select()
        .from(arTransactions)
        .where(
          and(eq(arTransactions.id, arTxnId), eq(arTransactions.propertyId, propertyId)),
        );
      if (!original) {
        throw new NotFoundException(`A/R transaction ${arTxnId} not found`);
      }
      if (original.type !== 'transfer_in') {
        throw new BadRequestException('Only a transfer_in transaction can be reversed');
      }
      if (original.reversedById) {
        throw new BadRequestException('Transfer has already been reversed');
      }

      const ledger = await this.findLedgerById(original.arLedgerId, propertyId, tx);
      const amount = new Decimal(original.amount);

      // Restore the folio balance by posting the original charge back (KB 11.4).
      if (original.sourceFolioId) {
        await this.folioService.postCharge(
          original.sourceFolioId,
          {
            propertyId,
            type: 'adjustment',
            description: `Reverse A/R transfer from ledger ${ledger.name}`,
            amount: amount.toFixed(2),
            currencyCode: original.currencyCode,
            serviceDate: new Date().toISOString(),
            skipTaxCalculation: true,
          },
          tx,
        );
      }

      const [reversal] = await tx
        .insert(arTransactions)
        .values({
          propertyId,
          arLedgerId: original.arLedgerId,
          type: 'reverse_transfer',
          amount: amount.negated().toFixed(2),
          currencyCode: original.currencyCode,
          sourceFolioId: original.sourceFolioId,
          note: `Reversal of transfer ${original.id}`,
        })
        .returning();

      await tx
        .update(arTransactions)
        .set({ reversedById: reversal.id })
        .where(and(eq(arTransactions.id, original.id), eq(arTransactions.propertyId, propertyId)));

      const newLedgerBalance = new Decimal(ledger.balance).minus(amount).toFixed(2);
      await tx
        .update(arLedgers)
        .set({ balance: newLedgerBalance, updatedAt: new Date() })
        .where(and(eq(arLedgers.id, original.arLedgerId), eq(arLedgers.propertyId, propertyId)));

      await this.webhookService.emit(
        'ar.transfer_reversed',
        'ar_transaction',
        reversal.id,
        { arLedgerId: original.arLedgerId, originalTxnId: original.id, amount: reversal.amount },
        propertyId,
      );
      return reversal;
    });
  }

  /**
   * Record a payment against an A/R ledger, reducing its balance (KB 11.5).
   */
  async recordARPayment(arLedgerId: string, dto: RecordArPaymentDto) {
    return this.db.transaction(async (tx: any) => {
      const ledger = await this.findLedgerById(arLedgerId, dto.propertyId, tx);
      const amount = new Decimal(dto.amount);

      const [txn] = await tx
        .insert(arTransactions)
        .values({
          propertyId: dto.propertyId,
          arLedgerId,
          type: 'payment',
          amount: amount.toFixed(2),
          currencyCode: dto.currencyCode,
          note: dto.note,
          createdBy: dto.createdBy,
        })
        .returning();

      const newLedgerBalance = new Decimal(ledger.balance).minus(amount).toFixed(2);
      await tx
        .update(arLedgers)
        .set({ balance: newLedgerBalance, updatedAt: new Date() })
        .where(and(eq(arLedgers.id, arLedgerId), eq(arLedgers.propertyId, dto.propertyId)));

      await this.webhookService.emit(
        'ar.payment_recorded',
        'ar_transaction',
        txn.id,
        { arLedgerId, amount: txn.amount },
        dto.propertyId,
      );
      return txn;
    });
  }

  /**
   * Age open balances into buckets (KB 11.5 [ASSUMPTION]):
   * 0–30 / 31–60 / 61–90 / 90+ days from the transfer date. Sums net
   * transfer_in amounts that have not been reversed.
   */
  async aging(propertyId: string, arLedgerId?: string) {
    const conditions: any[] = [
      eq(arTransactions.propertyId, propertyId),
      eq(arTransactions.type, 'transfer_in'),
      sql`${arTransactions.reversedById} is null`,
    ];
    if (arLedgerId) {
      conditions.push(eq(arTransactions.arLedgerId, arLedgerId));
    }

    const rows = await this.db
      .select()
      .from(arTransactions)
      .where(and(...conditions));

    const buckets = {
      current: new Decimal(0), // 0–30
      days31to60: new Decimal(0),
      days61to90: new Decimal(0),
      days90plus: new Decimal(0),
    };

    const now = Date.now();
    for (const row of rows) {
      const created = new Date(row.createdAt).getTime();
      const ageDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      const amount = new Decimal(row.amount);
      if (ageDays <= 30) buckets.current = buckets.current.plus(amount);
      else if (ageDays <= 60) buckets.days31to60 = buckets.days31to60.plus(amount);
      else if (ageDays <= 90) buckets.days61to90 = buckets.days61to90.plus(amount);
      else buckets.days90plus = buckets.days90plus.plus(amount);
    }

    const total = buckets.current
      .plus(buckets.days31to60)
      .plus(buckets.days61to90)
      .plus(buckets.days90plus);

    return {
      propertyId,
      arLedgerId: arLedgerId ?? null,
      buckets: {
        current: buckets.current.toFixed(2),
        days31to60: buckets.days31to60.toFixed(2),
        days61to90: buckets.days61to90.toFixed(2),
        days90plus: buckets.days90plus.toFixed(2),
      },
      total: total.toFixed(2),
    };
  }
}
