import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { accountingCodes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateAccountingCodeDto } from './dto/create-accounting-code.dto';
import { UpdateAccountingCodeDto } from './dto/update-accounting-code.dto';
import { ListAccountingCodesDto } from './dto/list-accounting-codes.dto';

/**
 * Custom accounting / GL codes (KB 5). Property-scoped CRUD. Archiving is a soft
 * delete so codes referenced by historical reports are retained.
 */
@Injectable()
export class AccountingCodeService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async create(dto: CreateAccountingCodeDto) {
    const [code] = await this.db
      .insert(accountingCodes)
      .values({
        propertyId: dto.propertyId,
        kind: dto.kind as 'transaction' | 'gl',
        code: dto.code,
        label: dto.label,
        appliesTo: dto.appliesTo,
      })
      .returning();
    return code;
  }

  async findById(id: string, propertyId: string) {
    const [code] = await this.db
      .select()
      .from(accountingCodes)
      .where(and(eq(accountingCodes.id, id), eq(accountingCodes.propertyId, propertyId)));
    if (!code) {
      throw new NotFoundException(`Accounting code ${id} not found`);
    }
    return code;
  }

  async list(dto: ListAccountingCodesDto) {
    const conditions: any[] = [eq(accountingCodes.propertyId, dto.propertyId)];
    if (dto.kind) {
      conditions.push(eq(accountingCodes.kind, dto.kind as 'transaction' | 'gl'));
    }
    if (!dto.includeArchived) {
      conditions.push(eq(accountingCodes.archived, false));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(accountingCodes)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(accountingCodes.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(accountingCodes)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async update(id: string, propertyId: string, dto: UpdateAccountingCodeDto) {
    await this.findById(id, propertyId);
    const [updated] = await this.db
      .update(accountingCodes)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(accountingCodes.id, id), eq(accountingCodes.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async archive(id: string, propertyId: string) {
    await this.findById(id, propertyId);
    const [updated] = await this.db
      .update(accountingCodes)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(accountingCodes.id, id), eq(accountingCodes.propertyId, propertyId)))
      .returning();
    return updated;
  }
}
