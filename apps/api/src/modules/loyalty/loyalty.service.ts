import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  loyaltyAccounts,
  loyaltyPrograms,
  loyaltyTransactions,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import {
  BurnLoyaltyPointsDto,
  EarnLoyaltyPointsDto,
  ListLoyaltyAccountsDto,
  ReleasePendingLoyaltyDto,
  UpsertLoyaltyProgramDto,
} from './dto/loyalty.dto';

@Injectable()
export class LoyaltyService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async upsertProgram(dto: UpsertLoyaltyProgramDto) {
    const [existing] = await this.db
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.organizationId, dto.organizationId));

    if (!existing) {
      const [program] = await this.db
        .insert(loyaltyPrograms)
        .values({
          organizationId: dto.organizationId,
          name: dto.name,
          pointsPerNight: dto.pointsPerNight ?? 100,
          delayDays: dto.delayDays ?? 3,
          earnEnabled: dto.earnEnabled ?? true,
        })
        .returning();
      return program;
    }

    const [program] = await this.db
      .update(loyaltyPrograms)
      .set({
        name: dto.name,
        pointsPerNight: dto.pointsPerNight ?? existing.pointsPerNight,
        delayDays: dto.delayDays ?? existing.delayDays,
        earnEnabled: dto.earnEnabled ?? existing.earnEnabled,
        updatedAt: new Date(),
      })
      .where(and(eq(loyaltyPrograms.id, existing.id), eq(loyaltyPrograms.organizationId, dto.organizationId)))
      .returning();

    return program;
  }

  async getAccounts(dto: ListLoyaltyAccountsDto) {
    const conditions: any[] = [eq(loyaltyAccounts.organizationId, dto.organizationId)];
    if (dto.guestId) conditions.push(eq(loyaltyAccounts.guestId, dto.guestId));

    return this.db
      .select()
      .from(loyaltyAccounts)
      .where(and(...conditions))
      .orderBy(desc(loyaltyAccounts.createdAt));
  }

  async earn(dto: EarnLoyaltyPointsDto) {
    return this.db.transaction(async (tx: any) => {
      const program = await this.findProgram(dto.organizationId, tx);
      if (!program.earnEnabled) {
        throw new BadRequestException('Loyalty earning is disabled for this organization');
      }

      const points = dto.nights * Number(program.pointsPerNight ?? 0);
      const account = await this.findOrCreateAccount(dto.organizationId, dto.guestId, program.id, tx);
      const availableAt = new Date(Date.now() + Number(program.delayDays ?? 0) * 86_400_000);

      const [updatedAccount] = await tx
        .update(loyaltyAccounts)
        .set({
          pendingPoints: Number(account.pendingPoints ?? 0) + points,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(loyaltyAccounts.id, account.id),
            eq(loyaltyAccounts.organizationId, dto.organizationId),
          ),
        )
        .returning();

      const [transaction] = await tx
        .insert(loyaltyTransactions)
        .values({
          organizationId: dto.organizationId,
          propertyId: dto.propertyId,
          accountId: account.id,
          type: 'earn',
          points,
          reservationId: dto.reservationId,
          note: dto.note,
          availableAt,
        })
        .returning();

      return { account: updatedAccount, transaction };
    });
  }

  async burn(dto: BurnLoyaltyPointsDto) {
    return this.db.transaction(async (tx: any) => {
      const account = await this.findAccount(dto.organizationId, dto.guestId, tx);
      if (!account) {
        throw new NotFoundException('Loyalty account not found');
      }
      if (Number(account.availablePoints ?? 0) < dto.points) {
        throw new BadRequestException('Insufficient available loyalty points');
      }

      const [updatedAccount] = await tx
        .update(loyaltyAccounts)
        .set({
          availablePoints: Number(account.availablePoints ?? 0) - dto.points,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(loyaltyAccounts.id, account.id),
            eq(loyaltyAccounts.organizationId, dto.organizationId),
          ),
        )
        .returning();

      const [transaction] = await tx
        .insert(loyaltyTransactions)
        .values({
          organizationId: dto.organizationId,
          propertyId: dto.propertyId,
          accountId: account.id,
          type: 'burn',
          points: dto.points,
          folioId: dto.folioId,
          note: dto.note,
        })
        .returning();

      return { account: updatedAccount, transaction };
    });
  }

  async releasePending(dto: ReleasePendingLoyaltyDto) {
    return this.db.transaction(async (tx: any) => {
      const accountConditions: any[] = [eq(loyaltyAccounts.organizationId, dto.organizationId)];
      if (dto.guestId) accountConditions.push(eq(loyaltyAccounts.guestId, dto.guestId));

      const accounts = await tx
        .select()
        .from(loyaltyAccounts)
        .where(and(...accountConditions));
      if (accounts.length === 0) {
        return { releasedAccounts: 0, releasedPoints: 0, releases: [] };
      }

      const accountIds = accounts.map((account: any) => account.id);
      const transactions = await tx
        .select()
        .from(loyaltyTransactions)
        .where(
          and(
            eq(loyaltyTransactions.organizationId, dto.organizationId),
            inArray(loyaltyTransactions.accountId, accountIds),
          ),
        );

      const releases: any[] = [];
      let releasedPoints = 0;
      const now = Date.now();

      for (const account of accounts) {
        const earnedPoints = transactions
          .filter(
            (row: any) =>
              row.accountId === account.id &&
              row.type === 'earn' &&
              row.availableAt &&
              new Date(row.availableAt).getTime() <= now,
          )
          .reduce((sum: number, row: any) => sum + Number(row.points ?? 0), 0);
        const priorReleases = transactions
          .filter((row: any) => row.accountId === account.id && row.type === 'release')
          .reduce((sum: number, row: any) => sum + Number(row.points ?? 0), 0);
        const releasable = Math.min(
          Number(account.pendingPoints ?? 0),
          Math.max(earnedPoints - priorReleases, 0),
        );

        if (releasable <= 0) continue;

        const [updatedAccount] = await tx
          .update(loyaltyAccounts)
          .set({
            pendingPoints: Number(account.pendingPoints ?? 0) - releasable,
            availablePoints: Number(account.availablePoints ?? 0) + releasable,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(loyaltyAccounts.id, account.id),
              eq(loyaltyAccounts.organizationId, dto.organizationId),
            ),
          )
          .returning();

        const [transaction] = await tx
          .insert(loyaltyTransactions)
          .values({
            organizationId: dto.organizationId,
            propertyId: dto.propertyId,
            accountId: account.id,
            type: 'release',
            points: releasable,
            note: 'Released pending loyalty points',
          })
          .returning();

        releases.push({ account: updatedAccount, transaction });
        releasedPoints += releasable;
      }

      return {
        releasedAccounts: releases.length,
        releasedPoints,
        releases,
      };
    });
  }

  private async findProgram(organizationId: string, tx?: any) {
    const db = tx ?? this.db;
    const [program] = await db
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.organizationId, organizationId));
    if (!program) {
      throw new NotFoundException('Loyalty program not found');
    }
    return program;
  }

  private async findAccount(organizationId: string, guestId: string, tx?: any) {
    const db = tx ?? this.db;
    const [account] = await db
      .select()
      .from(loyaltyAccounts)
      .where(
        and(
          eq(loyaltyAccounts.organizationId, organizationId),
          eq(loyaltyAccounts.guestId, guestId),
        ),
      );
    return account;
  }

  private async findOrCreateAccount(
    organizationId: string,
    guestId: string,
    programId: string,
    tx?: any,
  ) {
    const db = tx ?? this.db;
    const existing = await this.findAccount(organizationId, guestId, db);
    if (existing) {
      return existing;
    }

    const [account] = await db
      .insert(loyaltyAccounts)
      .values({
        organizationId,
        programId,
        guestId,
      })
      .returning();
    return account;
  }
}
