import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { houseAccounts, products, charges, payments } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { OpenHouseAccountDto } from './dto/open-house-account.dto';
import { ListHouseAccountsDto } from './dto/list-house-accounts.dto';
import { AddHouseAccountChargeDto } from './dto/add-house-account-charge.dto';
import { AddHouseAccountPaymentDto } from './dto/add-house-account-payment.dto';
import { SellProductDto } from './dto/sell-product.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';

/**
 * House accounts & non-guest sales (KB 13).
 *
 * A house account is a property-scoped ledger with NO reservation/guest link
 * (the defining trait, KB 13.1). It reuses the `charges`/`payments` ledger via a
 * nullable `houseAccountId` (folioId left null). Balance is recomputed the same
 * way as a folio: total charges minus CAPTURED payments.
 *
 * MULTI-TENANCY: every read/update/delete is scoped by
 * `and(eq(id), eq(propertyId))`. There is no guest-reservation link to verify
 * (unlike the cross-property `guests` table) — house accounts belong to exactly
 * one property.
 */
@Injectable()
export class HouseAccountService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  // --- House accounts ---

  async open(dto: OpenHouseAccountDto) {
    const [account] = await this.db
      .insert(houseAccounts)
      .values({
        propertyId: dto.propertyId,
        name: dto.name,
        kind: (dto.kind ?? 'retail') as 'retail' | 'vendor' | 'internal' | 'other',
        currencyCode: dto.currencyCode,
        notes: dto.notes,
        openedBy: dto.openedBy,
      })
      .returning();

    await this.webhookService.emit(
      'houseaccount.opened',
      'house_account',
      account.id,
      { name: account.name, kind: account.kind },
      account.propertyId,
    );

    return account;
  }

  async findById(id: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [account] = await db
      .select()
      .from(houseAccounts)
      .where(and(eq(houseAccounts.id, id), eq(houseAccounts.propertyId, propertyId)));
    if (!account) {
      throw new NotFoundException(`House account ${id} not found`);
    }
    return account;
  }

  async list(dto: ListHouseAccountsDto) {
    const conditions: any[] = [eq(houseAccounts.propertyId, dto.propertyId)];
    if (dto.kind) {
      conditions.push(eq(houseAccounts.kind, dto.kind as 'retail' | 'vendor' | 'internal' | 'other'));
    }
    if (dto.status) {
      conditions.push(eq(houseAccounts.status, dto.status as 'open' | 'closed'));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(houseAccounts)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(houseAccounts.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(houseAccounts)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async close(id: string, propertyId: string) {
    const account = await this.findById(id, propertyId);
    if (account.status !== 'open') {
      throw new BadRequestException('House account is not open');
    }
    const [updated] = await this.db
      .update(houseAccounts)
      .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(houseAccounts.id, id), eq(houseAccounts.propertyId, propertyId)))
      .returning();

    await this.webhookService.emit(
      'houseaccount.closed',
      'house_account',
      updated.id,
      { name: updated.name, balance: updated.balance },
      updated.propertyId,
    );

    return updated;
  }

  async addCharge(id: string, propertyId: string, dto: AddHouseAccountChargeDto) {
    const account = await this.findById(id, propertyId);
    if (account.status !== 'open') {
      throw new BadRequestException('Cannot post a charge to a closed house account');
    }

    const [charge] = await this.db
      .insert(charges)
      .values({
        propertyId,
        // House-account charge: no folio, the ledger row is tied to the account.
        folioId: null,
        houseAccountId: id,
        type: (dto.type ?? 'incidental') as any,
        description: dto.description,
        amount: dto.amount,
        currencyCode: dto.currencyCode,
        taxAmount: dto.taxAmount ?? '0',
        taxCode: dto.taxCode,
        serviceDate: new Date(),
        postedBy: dto.postedBy,
      })
      .returning();

    await this.recalcBalance(id, propertyId);

    await this.webhookService.emit(
      'houseaccount.charge_posted',
      'charge',
      charge.id,
      { houseAccountId: id, type: charge.type, amount: charge.amount, description: charge.description },
      propertyId,
    );

    return charge;
  }

  async addPayment(id: string, propertyId: string, dto: AddHouseAccountPaymentDto) {
    const account = await this.findById(id, propertyId);
    if (account.status !== 'open') {
      throw new BadRequestException('Cannot record a payment on a closed house account');
    }

    const [payment] = await this.db
      .insert(payments)
      .values({
        propertyId,
        folioId: null,
        houseAccountId: id,
        method: dto.method as any,
        amount: dto.amount,
        currencyCode: dto.currencyCode,
        status: 'captured',
        processedAt: new Date(),
        notes: dto.notes,
      })
      .returning();

    await this.recalcBalance(id, propertyId);

    await this.webhookService.emit(
      'houseaccount.payment_recorded',
      'payment',
      payment.id,
      { houseAccountId: id, method: payment.method, amount: payment.amount },
      propertyId,
    );

    return payment;
  }

  async sellProduct(id: string, propertyId: string, dto: SellProductDto) {
    const account = await this.findById(id, propertyId);
    if (account.status !== 'open') {
      throw new BadRequestException('Cannot sell on a closed house account');
    }

    const [product] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, dto.productId), eq(products.propertyId, propertyId)));
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }
    if (!product.isActive) {
      throw new BadRequestException('Product is not active');
    }

    const quantity = dto.quantity ?? 1;
    // Money math via decimal.js (numeric-as-string).
    const lineTotal = new Decimal(product.price).times(quantity).toFixed(2);

    // Non-room revenue (KB 13.4) — post as an incidental charge.
    const charge = await this.addCharge(id, propertyId, {
      propertyId,
      type: 'incidental',
      description: `${product.name} x${quantity}`,
      amount: lineTotal,
      currencyCode: product.currencyCode,
      taxCode: product.taxCode ?? undefined,
    });

    let payment: any = null;
    if (dto.paymentMethod) {
      payment = await this.addPayment(id, propertyId, {
        propertyId,
        method: dto.paymentMethod,
        amount: lineTotal,
        currencyCode: product.currencyCode,
        notes: `Sale of ${product.name} x${quantity}`,
      });
    }

    const account2 = await this.findById(id, propertyId);

    return {
      houseAccountId: id,
      product: { id: product.id, name: product.name, price: product.price },
      quantity,
      lineTotal,
      currencyCode: product.currencyCode,
      charge,
      payment,
      balance: account2.balance,
    };
  }

  /**
   * Recompute a house account's running balance from its ledger rows: total
   * charges (amount + tax) minus CAPTURED payments. Mirrors
   * FolioService.recalculateBalance but filtered by houseAccountId.
   */
  private async recalcBalance(houseAccountId: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [chargeSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${charges.amount}::numeric + ${charges.taxAmount}::numeric), 0)`,
      })
      .from(charges)
      .where(
        and(eq(charges.houseAccountId, houseAccountId), eq(charges.propertyId, propertyId)),
      );

    const [paymentSum] = await db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.houseAccountId, houseAccountId),
          eq(payments.propertyId, propertyId),
          eq(payments.status, 'captured'),
        ),
      );

    const totalCharges = new Decimal(chargeSum?.total ?? '0').toFixed(2);
    const totalPayments = new Decimal(paymentSum?.total ?? '0').toFixed(2);
    const balance = new Decimal(totalCharges).minus(new Decimal(totalPayments)).toFixed(2);

    await db
      .update(houseAccounts)
      .set({ totalCharges, totalPayments, balance, updatedAt: new Date() })
      .where(
        and(eq(houseAccounts.id, houseAccountId), eq(houseAccounts.propertyId, propertyId)),
      );
  }

  // --- Products (retail catalog, KB 13.3) ---

  async createProduct(dto: CreateProductDto) {
    const [product] = await this.db
      .insert(products)
      .values({
        propertyId: dto.propertyId,
        category: dto.category,
        name: dto.name,
        price: dto.price,
        currencyCode: dto.currencyCode,
        taxCode: dto.taxCode,
        isActive: dto.isActive ?? true,
      })
      .returning();
    return product;
  }

  async findProductById(id: string, propertyId: string) {
    const [product] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.propertyId, propertyId)));
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async listProducts(dto: ListProductsDto) {
    const conditions: any[] = [eq(products.propertyId, dto.propertyId)];
    if (dto.category) conditions.push(eq(products.category, dto.category));
    if (dto.isActive !== undefined) {
      conditions.push(eq(products.isActive, dto.isActive === 'true'));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(products.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async updateProduct(id: string, propertyId: string, dto: UpdateProductDto) {
    await this.findProductById(id, propertyId);
    const [updated] = await this.db
      .update(products)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.propertyId, propertyId)))
      .returning();
    return updated;
  }
}
