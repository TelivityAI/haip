import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
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

const CHARGE_WAS_CREATED = Symbol('chargeWasCreated');

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
    if (!tx) {
      await this.webhookService.emit(
        'folio.created',
        'folio',
        folio.id,
        { folioNumber: folio.folioNumber, type: folio.type },
        folio.propertyId,
      );
    }
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
    if (folioId === dto.targetFolioId) {
      throw new BadRequestException('Source and target folio must differ');
    }

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

  async postCharge(
    folioId: string,
    dto: CreateChargeDto,
    tx?: any,
    persistence?: { parentChargeId?: string; sourceKey?: string },
  ) {
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
      // Operational integrity: a reversal cannot itself be reversed. Undo a
      // mistaken reversal by re-posting the original charge.
      if (dto.isReversal && original.isReversal) {
        throw new BadRequestException('Cannot reverse a reversal transaction');
      }
    }

    const insert = db
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
        parentChargeId: persistence?.parentChargeId,
        sourceKey: persistence?.sourceKey,
        postedBy: dto.postedBy,
      });
    const [charge] = persistence?.sourceKey
      ? await insert
          .onConflictDoNothing({
            target: [charges.propertyId, charges.folioId, charges.sourceKey],
          })
          .returning()
      : await insert.returning();
    if (!charge && persistence?.sourceKey) {
      const [existing] = await db
        .select()
        .from(charges)
        .where(and(
          eq(charges.propertyId, dto.propertyId),
          eq(charges.folioId, folioId),
          eq(charges.sourceKey, persistence.sourceKey),
        ));
      if (!existing) {
        throw new ConflictException('Charge source key was claimed without a persisted charge');
      }
      const replay = { ...existing, taxCharges: [] };
      Object.defineProperty(replay, CHARGE_WAS_CREATED, { value: false });
      return replay;
    }

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

    if (!tx) {
      await this.webhookService.emit(
        'folio.charge_posted',
        'charge',
        charge.id,
        { folioId, type: charge.type, amount: charge.amount, description: charge.description },
        dto.propertyId,
      );
    }

    const result = { ...charge, taxCharges };
    Object.defineProperty(result, CHARGE_WAS_CREATED, { value: true });
    return result;
  }

  /** Post an immutable accepted base/tax pair atomically without live tax lookup. */
  async postChargeFromSnapshot(
    folioId: string,
    dto: CreateChargeDto,
    taxAmount: string,
    adjustment?: { amount: string; reason: string },
    sourceKey?: string,
  ) {
    const result = await this.db.transaction(async (tx: any) => {
      const base = await this.postCharge(folioId, {
        ...dto,
        skipTaxCalculation: true,
      }, tx, { sourceKey });
      if ((base as any)[CHARGE_WAS_CREATED] === false) {
        const children = await tx
          .select()
          .from(charges)
          .where(and(
            eq(charges.propertyId, dto.propertyId),
            eq(charges.folioId, folioId),
            eq(charges.parentChargeId, base.id),
            eq(charges.isReversal, false),
          ));
        return {
          ...base,
          taxCharges: children.filter((child: any) => child.type === 'tax'),
          adjustmentCharges: children.filter((child: any) => child.type === 'adjustment'),
          wasCreated: false,
        };
      }
      const taxCharges: any[] = [];
      if (new Decimal(taxAmount).greaterThan(0)) {
        const frozenTax = await this.postCharge(folioId, {
          propertyId: dto.propertyId,
          type: 'tax',
          description: `${dto.description} tax`.slice(0, 255),
          amount: new Decimal(taxAmount).toFixed(2),
          currencyCode: dto.currencyCode,
          serviceDate: dto.serviceDate,
          postedBy: dto.postedBy,
          skipTaxCalculation: true,
        }, tx, { parentChargeId: base.id });
        const { taxCharges: _nestedTaxes, ...taxCharge } = frozenTax;
        void _nestedTaxes;
        taxCharges.push(taxCharge);
      }
      const adjustmentCharges: any[] = [];
      if (adjustment && !new Decimal(adjustment.amount).isZero()) {
        const frozenAdjustment = await this.postCharge(folioId, {
          propertyId: dto.propertyId,
          type: 'adjustment',
          description: `Accepted price adjustment: ${adjustment.reason}`.slice(0, 255),
          amount: new Decimal(adjustment.amount).toFixed(2),
          currencyCode: dto.currencyCode,
          serviceDate: dto.serviceDate,
          postedBy: dto.postedBy,
          skipTaxCalculation: true,
        }, tx, { parentChargeId: base.id });
        const { taxCharges: _nestedTaxes, ...adjustmentCharge } = frozenAdjustment;
        void _nestedTaxes;
        adjustmentCharges.push(adjustmentCharge);
      }
      return { ...base, taxCharges, adjustmentCharges, wasCreated: true };
    });

    if (!result.wasCreated) {
      const { wasCreated: _wasCreated, ...existing } = result;
      void _wasCreated;
      return existing;
    }

    await this.webhookService.emit(
      'folio.charge_posted',
      'charge',
      result.id,
      {
        folioId,
        type: result.type,
        amount: result.amount,
        description: result.description,
      },
      dto.propertyId,
    );
    for (const tax of result.taxCharges) {
      await this.webhookService.emit(
        'folio.charge_posted',
        'charge',
        tax.id,
        {
          folioId,
          type: tax.type,
          amount: tax.amount,
          description: tax.description,
        },
        dto.propertyId,
      );
    }
    for (const adjustmentCharge of result.adjustmentCharges) {
      await this.webhookService.emit(
        'folio.charge_posted',
        'charge',
        adjustmentCharge.id,
        {
          folioId,
          type: adjustmentCharge.type,
          amount: adjustmentCharge.amount,
          description: adjustmentCharge.description,
        },
        dto.propertyId,
      );
    }
    const { wasCreated: _wasCreated, ...posted } = result;
    void _wasCreated;
    return posted;
  }

  async reverseCharge(folioId: string, chargeId: string, propertyId: string) {
    const reverseInTransaction = async (db: any) => {
      const originalQuery = db
        .select()
        .from(charges)
        .where(
          and(
            eq(charges.id, chargeId),
            eq(charges.folioId, folioId),
            eq(charges.propertyId, propertyId),
          ),
        );
      const [original] = typeof originalQuery.for === 'function'
        ? await originalQuery.for('update')
        : await originalQuery;
      if (!original) {
        throw new NotFoundException(`Charge ${chargeId} not found`);
      }
      if (original.isLocked) {
        throw new BadRequestException('Cannot reverse a locked charge');
      }
      // Operational integrity: a reversal cannot itself be reversed. Undo a
      // mistaken reversal by re-posting the original charge.
      if (original.isReversal) {
        throw new BadRequestException('Cannot reverse a reversal transaction');
      }

      // The original row lock serializes competing whole-group reversals.
      const [existing] = await db
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

      const [reversal] = await db
        .insert(charges)
        .values({
          propertyId,
          folioId,
          type: original.type,
          description: `Reversal: ${original.description}`,
          amount: new Decimal(original.amount).negated().toFixed(2),
          currencyCode: original.currencyCode,
          taxAmount: new Decimal(original.taxAmount).negated().toFixed(2),
          taxRate: original.taxRate,
          taxCode: original.taxCode,
          serviceDate: original.serviceDate,
          isReversal: true,
          originalChargeId: chargeId,
        })
        .returning();

      // Cascade every immutable component linked to the base. Canonical
      // live-tax rows and frozen tax/custom-adjustment rows all share
      // parentChargeId. Locking children also makes a concurrent direct child
      // reversal resolve before this group decides whether it still needs one.
      const childQuery = db
        .select()
        .from(charges)
        .where(
          and(
            eq(charges.parentChargeId, chargeId),
            eq(charges.isReversal, false),
          ),
        );
      const childCharges = typeof childQuery.for === 'function'
        ? await childQuery.for('update')
        : await childQuery;

      for (const childCharge of childCharges) {
        const [existingChildReversal] = await db
          .select()
          .from(charges)
          .where(
            and(eq(charges.originalChargeId, childCharge.id), eq(charges.isReversal, true)),
          );
        if (existingChildReversal) continue;

        await db
          .insert(charges)
          .values({
            propertyId,
            folioId,
            type: childCharge.type,
            description: `Reversal: ${childCharge.description}`,
            amount: new Decimal(childCharge.amount).negated().toFixed(2),
            currencyCode: childCharge.currencyCode,
            taxAmount: new Decimal(childCharge.taxAmount ?? '0').negated().toFixed(2),
            taxRate: childCharge.taxRate,
            taxCode: childCharge.taxCode,
            serviceDate: childCharge.serviceDate,
            isReversal: true,
            originalChargeId: childCharge.id,
            parentChargeId: reversal.id,
          })
          .returning();
      }

      await this.recalculateBalance(folioId, propertyId, db);
      return reversal;
    };

    const reversal = typeof this.db.transaction === 'function'
      ? await this.db.transaction(reverseInTransaction)
      : await reverseInTransaction(this.db);

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
  }, tx?: any) {
    return this.create({
      propertyId: reservation.propertyId,
      reservationId: reservation.id,
      bookingId: reservation.bookingId ?? undefined,
      guestId: reservation.guestId,
      type: 'guest',
      currencyCode: reservation.currencyCode,
    }, tx);
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
