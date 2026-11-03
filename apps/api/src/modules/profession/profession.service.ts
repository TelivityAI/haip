import { Inject, Injectable } from '@nestjs/common';
import { ilike, or, eq, sql, desc, asc } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import { professions } from '@telivityhaip/database';
import { CreateProfessionDto } from './dto/create-profession.dto';
import { SearchProfessionsDto } from './dto/search-professions.dto';

@Injectable()
export class ProfessionService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: any,
  ) {}

  async search(dto: SearchProfessionsDto) {
    const q = dto.q?.trim();
    const limit = dto.limit ?? 25;

    let query = this.db.select().from(professions).$dynamic();

    const conditions = [];

    if (q) {
      conditions.push(
        or(
          ilike(professions.name, `%${q}%`),
          ilike(professions.code, `%${q}%`),
        ),
      );
    }

    if (dto.countryCode) {
      conditions.push(eq(professions.countryCode, dto.countryCode.toUpperCase()));
    }

    if (conditions.length > 0) {
      query = query.where(sql.join(conditions, sql` AND `));
    }

    // Sort: if q matches exact prefix, prioritize it, otherwise alphabetical
    if (q) {
      query = query.orderBy(
        sql`CASE WHEN lower(${professions.name}) = lower(${q}) THEN 0 WHEN lower(${professions.name}) LIKE lower(${q} || '%') THEN 1 ELSE 2 END`,
        asc(professions.name),
      );
    } else {
      query = query.orderBy(asc(professions.name));
    }

    const rows = await query.limit(limit);
    return {
      data: rows,
      count: rows.length,
    };
  }

  async findOrCreate(dto: CreateProfessionDto) {
    const trimmedName = dto.name.trim();

    // Check if profession with exact same name already exists
    const existing = await this.db
      .select()
      .from(professions)
      .where(ilike(professions.name, trimmedName))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      return existing[0];
    }

    const [created] = await this.db
      .insert(professions)
      .values({
        name: trimmedName,
        code: dto.code?.trim() || null,
        countryCode: dto.countryCode ? dto.countryCode.trim().toUpperCase() : null,
        isSystem: false,
        metadata: dto.metadata ?? null,
      })
      .returning();

    return created;
  }
}
