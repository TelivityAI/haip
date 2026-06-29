import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { folios, charges, payments, reservations, bookings } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { folioPaymentSumWhere } from '../payment/payment-ledger';
import { WebhookService } from '../webhook/webhook.service';
import { TaxService } from '../tax/tax.service';
import { CreateFolioDto } from './dto/create-folio.dto';
import { UpdateFolioDto } from './dto/update-folio.dto';
import { ListFoliosDto } from './dto/list-folios.dto';
import { TransferChargeDto } from './dto/transfer-charge.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { ListChargesDto } from './dto/list-charges.dto';

@Injectable()
export class FolioService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly taxService: TaxService,
  ) {}

  async create(dto: CreateFolioDto, tx?: any) {
    const db = tx ?? this.db;
    // FK ownership (security audit follow-on): the caller supplies reservationId
    // and bookingId in the DTO. Without scoping these to dto.propertyId, a caller
    // at property A could attach a folio to property B's reservation/booking.
    // (Guest is intentionally cross-property by design per CLAUDE.md.)
    if (dto.reservationId) {
      const [r] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, dto.reservationId), eq(reservations.propertyId, dto.propertyId)));
      if (!r) throw new BadRequestException(`reservation ${dto.reservationId} not found in this property`);
    }
    if (dto.bookingId) {
      const [b] = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, dto.bookingId), eq(bookings.propertyId, dto.propertyId)));
      if (!b) throw new BadRequestException(`booking ${dto.bookingId} not found in this property`);
    }
    const folioNumber = await this.generateFolioNumber(dto.propertyId, tx);
    const [folio] = await db
      .insert(folios)
      .values({ ...dto, folioNumber })
      .returning();
    await this.webhookService.emit(
      'folio.created',
      'folio',
      folio.id,
      { folioNumber: folio.folioNumber, type: folio.type },
      folio.propertyId,
    );
    return folio;
  }

  async findById(id: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [folio] = await db
      .select()
      .from(folios)
      .where(and(eq(folios.id, id), eq(folios.propertyId, propertyId)));
    if (!folio) {
      throw new NotFoundException(`Folio ${id} not found`);
    }
    return folio;
  }

  async list(dto: ListFoliosDto) {
    const conditions: any[] = [eq(folios.propertyId, dto.propertyId)];

    if (dto.reservationId) conditions.push(eq(folios.reservationId, dto.reservationId));
    if (dto.guestId) conditions.push(eq(folios.guestId, dto.guestId));
    if (dto.type) conditions.push(eq(folios.type, dto.type as 'guest' | 'master' | 'city_ledger'));
    if (dto.status) conditions.push(eq(folios.status, dto.status as 'open' | 'settled' | 'closed'));

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(folios)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(folios.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(folios)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async update(id: string, propertyId: string, dto: UpdateFolioDto) {
    const folio = await this.findById(id, propertyId);
    if (folio.status !== 'open') {
      throw new BadRequestException('Cannot update a folio that is not open');
    }
    const [updated] = await this.db
      .update(folios)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(folios.id, id), eq(folios.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async settle(id: string, propertyId: string) {
    const folio = await this.findById(id, propertyId);
    if (folio.status !== 'open') {
      throw new BadRequestException('Folio is not open');
    }
    if (new Decimal(folio.balance).abs().gt('0.01')) {
      throw new BadRequestException(
        `Folio balance must be zero to settle (current: ${folio.balance})`,
      );
    }

    // Check for outstanding authorizations
    const [pendingPayments] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(payments)
      .where(
        and(
          eq(payments.folioId, id),
          eq(payments.propertyId, propertyId),
          sql`${payments.status} in ('authorized', 'pending')`,
        ),
      );
    if (Number(pendingPayments?.count ?? 0) > 0) {
      throw new BadRequestException(
        'Cannot settle folio with outstanding authorized or pending payments',
      );
    }
    const [updated] = await this.db
      .update(folios)
      .set({
        status: 'settled',
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(folios.id, id), eq(folios.propertyId, propertyId)))
      .returning();
    await this.webhookService.emit(
      'folio.settled',
      'folio',
      updated.id,
      { folioNumber: updated.folioNumber, balance: updated.balance },
      updated.propertyId,
    );
    return updated;
  }

  async close(id: string, propertyId: string) {
    const folio = await this.findById(id, propertyId);
    if (folio.status !== 'settled') {
      throw new BadRequestException('Folio must be settled before closing');
    }
    const [updated] = await this.db
      .update(folios)
      .set({
        status: 'closed',
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(folios.id, id), eq(folios.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async transferCharge(folioId: string, propertyId: string, dto: TransferChargeDto) {
    // Bug 2: wrap charge move + both balance recalculations in a transaction,
    // and SELECT ... FOR UPDATE both folio rows up-front so concurrent
    // transfers/recalculations on the same folios are serialized.
    return this.db.transaction(async (tx: any) => {
      // Lock both folios (deterministic order by id to avoid deadlock)
      const [firstId, secondId] = [folioId, dto.targetFolioId].sort();

      const [firstFolio] = await tx
        .select()
        .from(folios)
        .where(and(eq(folios.id, firstId!), eq(folios.propertyId, propertyId)))
        .for('update');
      if (!firstFolio) {
        throw new NotFoundException(`Folio ${firstId} not found`);
      }
      let secondFolio: any = firstFolio;
      if (secondId && secondId !== firstId) {
        const [row] = await tx
          .select()
          .from(folios)
          .where(and(eq(folios.id, secondId), eq(folios.propertyId, propertyId)))
          .for('update');
        if (!row) {
          throw new NotFoundException(`Folio ${secondId} not found`);
        }
        secondFolio = row;
      }

      const sourceFolio = firstFolio.id === folioId ? firstFolio : secondFolio;
      const targetFolio = firstFolio.id === dto.targetFolioId ? firstFolio : secondFolio;

      if (sourceFolio.status !== 'open') {
        throw new BadRequestException('Source folio is not open');
      }
      if (targetFolio.status !== 'open') {
        throw new BadRequestException('Target folio is not open');
      }

      const [charge] = await tx
        .select()
        .from(charges)
        .where(
          and(
            eq(charges.id, dto.chargeId),
            eq(charges.folioId, folioId),
            eq(charges.propertyId, propertyId),
          ),
        );
      if (!charge) {
        throw new NotFoundException(`Charge ${dto.chargeId} not found on folio ${folioId}`);
      }
      if (charge.isLocked) {
        throw new BadRequestException('Cannot transfer a locked charge');
      }

      await tx
        .update(charges)
        .set({ folioId: dto.targetFolioId })
        .where(eq(charges.id, dto.chargeId));

      await this.recalculateBalance(folioId, propertyId, tx);
      await this.recalculateBalance(dto.targetFolioId, propertyId, tx);

      return { transferred: true };
    });
  }

  async recalculateBalance(folioId: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [chargeSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${charges.amount}::numeric + ${charges.taxAmount}::numeric), 0)`,
      })
      .from(charges)
      .where(and(eq(charges.folioId, folioId), eq(charges.propertyId, propertyId)));

    const [paymentSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(folioPaymentSumWhere(folioId, propertyId));

    // Monetary math: operate on string representations via decimal.js to
    // preserve precision (postgres numeric returns strings).
    const totalCharges = new Decimal(chargeSum?.total ?? '0').toFixed(2);
    const totalPayments = new Decimal(paymentSum?.total ?? '0').toFixed(2);
    const balance = new Decimal(totalCharges).minus(new Decimal(totalPayments)).toFixed(2);

    await db
      .update(folios)
      .set({ totalCharges, totalPayments, balance, updatedAt: new Date() })
      .where(and(eq(folios.id, folioId), eq(folios.propertyId, propertyId)));
  }

  async postCharge(folioId: string, dto: CreateChargeDto, tx?: any) {
    const db = tx ?? this.db;
    const folio = await this.findById(folioId, dto.propertyId, tx);
    if (folio.status !== 'open') {
      throw new BadRequestException('Cannot post charge to a folio that is not open');
    }

    // A negative/zero amount inverts or zeroes the folio balance. Only legitimate
    // credit paths may go non-positive: an explicit `adjustment` charge or a
    // reversal. Everything else must be strictly positive.
    if (
      new Decimal(dto.amount).lessThanOrEqualTo(0) &&
      dto.type !== 'adjustment' &&
      !dto.isReversal
    ) {
      throw new BadRequestException(
        'Charge amount must be positive (negatives are only allowed for adjustments or reversals)',
      );
    }

    // Validate originalChargeId WHENEVER supplied (not only for reversals) so a
    // caller can't attach a dangling reference to another property's charge.
    if (dto.originalChargeId) {
      const [original] = await db
        .select()
        .from(charges)
        .where(
          and(
            eq(charges.id, dto.originalChargeId),
            eq(charges.folioId, folioId),
            eq(charges.propertyId, dto.propertyId),
          ),
        );
      if (!original) {
        throw new NotFoundException(`Original charge ${dto.originalChargeId} not found`);
      }
      if (dto.isReversal && original.isLocked) {
        throw new BadRequestException('Cannot reverse a locked charge');
      }
    }

    const [charge] = await db
      .insert(charges)
      .values({
        propertyId: dto.propertyId,
        folioId,
        type: dto.type,
        description: dto.description,
        amount: dto.amount,
        currencyCode: dto.currencyCode,
        taxAmount: dto.taxAmount ?? '0',
        taxRate: dto.taxRate,
        taxCode: dto.taxCode,
        serviceDate: new Date(dto.serviceDate),
        isReversal: dto.isReversal ?? false,
        originalChargeId: dto.originalChargeId,
        postedBy: dto.postedBy,
      })
      .returning();

    // Auto-post tax charges if this is a taxable charge (not a tax or reversal itself)
    const taxCharges: any[] = [];
    if (charge.type !== 'tax' && charge.type !== 'adjustment' && !charge.isReversal && !dto.skipTaxCalculation) {
      const taxItems = await this.taxService.calculateTaxes(
        dto.amount,
        dto.type,
        dto.propertyId,
        dto.serviceDate,
        { guestId: dto.guestId, numberOfNights: dto.numberOfNights, nightNumber: dto.nightNumber },
      );

      for (const item of taxItems) {
        const [taxCharge] = await db
          .insert(charges)
          .values({
            propertyId: dto.propertyId,
            folioId,
            type: 'tax',
            description: item.name,
            amount: item.amount,
            currencyCode: dto.currencyCode,
            taxAmount: '0',
            taxRate: item.rate,
            taxCode: item.code,
            serviceDate: new Date(dto.serviceDate),
            parentChargeId: charge.id,
            postedBy: dto.postedBy,
          })
          .returning();
        taxCharges.push(taxCharge);
      }
    }

    await this.recalculateBalance(folioId, dto.propertyId, tx);

    await this.webhookService.emit(
      'folio.charge_posted',
      'charge',
      charge.id,
      { folioId, type: charge.type, amount: charge.amount, description: charge.description },
      dto.propertyId,
    );

    return { ...charge, taxCharges };
  }

  async reverseCharge(folioId: string, chargeId: string, propertyId: string) {
    const [original] = await this.db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.id, chargeId),
          eq(charges.folioId, folioId),
          eq(charges.propertyId, propertyId),
        ),
      );
    if (!original) {
      throw new NotFoundException(`Charge ${chargeId} not found`);
    }
    if (original.isLocked) {
      throw new BadRequestException('Cannot reverse a locked charge');
    }

    // Check if already reversed
    const [existing] = await this.db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.originalChargeId, chargeId),
          eq(charges.isReversal, true),
        ),
      );
    if (existing) {
      throw new BadRequestException('Charge has already been reversed');
    }

    const negatedAmount = new Decimal(original.amount).negated().toFixed(2);
    const negatedTax = new Decimal(original.taxAmount).negated().toFixed(2);

    const [reversal] = await this.db
      .insert(charges)
      .values({
        propertyId,
        folioId,
        type: original.type,
        description: `Reversal: ${original.description}`,
        amount: negatedAmount,
        currencyCode: original.currencyCode,
        taxAmount: negatedTax,
        taxRate: original.taxRate,
        taxCode: original.taxCode,
        serviceDate: original.serviceDate,
        isReversal: true,
        originalChargeId: chargeId,
      })
      .returning();

    // Cascade: reverse all child tax charges linked to this charge
    const childTaxCharges = await this.db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.parentChargeId, chargeId),
          eq(charges.type, 'tax' as any),
          eq(charges.isReversal, false),
        ),
      );

    for (const taxCharge of childTaxCharges) {
      // Check not already reversed
      const [existingTaxReversal] = await this.db
        .select()
        .from(charges)
        .where(
          and(eq(charges.originalChargeId, taxCharge.id), eq(charges.isReversal, true)),
        );
      if (existingTaxReversal) continue;

      await this.db
        .insert(charges)
        .values({
          propertyId,
          folioId,
          type: 'tax',
          description: `Reversal: ${taxCharge.description}`,
          amount: new Decimal(taxCharge.amount).negated().toFixed(2),
          currencyCode: taxCharge.currencyCode,
          taxAmount: '0',
          taxRate: taxCharge.taxRate,
          taxCode: taxCharge.taxCode,
          serviceDate: taxCharge.serviceDate,
          isReversal: true,
          originalChargeId: taxCharge.id,
          parentChargeId: reversal.id,
        })
        .returning();
    }

    await this.recalculateBalance(folioId, propertyId);

    await this.webhookService.emit(
      'folio.charge_posted',
      'charge',
      reversal.id,
      { folioId, type: reversal.type, amount: reversal.amount, isReversal: true },
      propertyId,
    );

    return reversal;
  }

  async getCharges(folioId: string, dto: ListChargesDto) {
    const conditions: any[] = [
      eq(charges.folioId, folioId),
      eq(charges.propertyId, dto.propertyId),
    ];

    if (dto.type) conditions.push(eq(charges.type, dto.type as any));
    if (dto.serviceDateFrom) conditions.push(gte(charges.serviceDate, new Date(dto.serviceDateFrom)));
    if (dto.serviceDateTo) conditions.push(lte(charges.serviceDate, new Date(dto.serviceDateTo)));

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(charges)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(charges.serviceDate),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(charges)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async lockCharges(folioId: string, propertyId: string, auditDate: Date) {
    const result = await this.db
      .update(charges)
      .set({ isLocked: true, lockedByAuditDate: auditDate })
      .where(
        and(
          eq(charges.folioId, folioId),
          eq(charges.propertyId, propertyId),
          eq(charges.isLocked, false),
          lte(charges.serviceDate, auditDate),
        ),
      )
      .returning();
    return { lockedCount: result.length };
  }

  async postRoomTariff(
    folioId: string,
    propertyId: string,
    rate: string,
    currencyCode: string,
    serviceDate: Date,
  ) {
    return this.postCharge(folioId, {
      propertyId,
      type: 'room',
      description: `Room tariff - ${serviceDate.toISOString().split('T')[0]}`,
      amount: rate,
      currencyCode,
      serviceDate: serviceDate.toISOString(),
    });
  }

  async createAutoFolio(reservation: {
    id: string;
    propertyId: string;
    bookingId?: string | null;
    guestId: string;
    currencyCode: string;
  }) {
    return this.create({
      propertyId: reservation.propertyId,
      reservationId: reservation.id,
      bookingId: reservation.bookingId ?? undefined,
      guestId: reservation.guestId,
      type: 'guest',
      currencyCode: reservation.currencyCode,
    });
  }

  private async generateFolioNumber(propertyId: string, tx?: any): Promise<string> {
    const db = tx ?? this.db;
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `F-${yy}${mm}${dd}`;

    // Use MAX to find the highest existing sequence for this prefix,
    // which is safe under concurrent inserts (unique constraint prevents duplicates)
    const [result] = await db
      .select({
        maxNumber: sql<string>`max(${folios.folioNumber})`,
      })
      .from(folios)
      .where(
        and(
          eq(folios.propertyId, propertyId),
          sql`${folios.folioNumber} like ${prefix + '%'}`,
        ),
      );

    let seq = 1;
    if (result?.maxNumber) {
      const lastSeq = parseInt(result.maxNumber.split('-').pop() ?? '0', 10);
      seq = lastSeq + 1;
    }
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }
}
