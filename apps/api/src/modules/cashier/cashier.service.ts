import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  cashDrawers,
  cashDrawerSessions,
  cashMovements,
  reservations,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { CreateDrawerDto } from './dto/create-drawer.dto';
import { OpenSessionDto } from './dto/open-session.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { CloseSessionDto } from './dto/close-session.dto';

/**
 * Cash handling & cashiering service (KB 12).
 *
 * Tracks cash-only drawers (KB 12.1), sessions/shifts (KB 12.2), movements
 * (KB 12.3), and computes expected balance / variance at close (KB 12.4).
 * Control [ASSUMPTION KB 12.5]: one open session per user per drawer.
 */
@Injectable()
export class CashierService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  // --- Drawers (KB 12.1) ---

  async createDrawer(dto: CreateDrawerDto) {
    const [drawer] = await this.db
      .insert(cashDrawers)
      .values({
        propertyId: dto.propertyId,
        name: dto.name,
        startingFloat: new Decimal(dto.startingFloat ?? '0').toFixed(2),
        isActive: dto.isActive ?? true,
      })
      .returning();
    return drawer;
  }

  async findDrawerById(id: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [drawer] = await db
      .select()
      .from(cashDrawers)
      .where(and(eq(cashDrawers.id, id), eq(cashDrawers.propertyId, propertyId)));
    if (!drawer) {
      throw new NotFoundException(`Cash drawer ${id} not found`);
    }
    return drawer;
  }

  // --- Sessions (KB 12.2) ---

  async findSessionById(id: string, propertyId: string, tx?: any) {
    const db = tx ?? this.db;
    const [session] = await db
      .select()
      .from(cashDrawerSessions)
      .where(
        and(eq(cashDrawerSessions.id, id), eq(cashDrawerSessions.propertyId, propertyId)),
      );
    if (!session) {
      throw new NotFoundException(`Cash session ${id} not found`);
    }
    return session;
  }

  /**
   * Open a session/shift (KB 12.2). The opening float defaults to the drawer's
   * starting float. Control: one open session per user per drawer (KB 12.5).
   */
  async openSession(dto: OpenSessionDto) {
    const drawer = await this.findDrawerById(dto.cashDrawerId, dto.propertyId);

    // One open session per user per drawer (KB 12.5).
    const [existing] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.propertyId, dto.propertyId),
          eq(cashDrawerSessions.cashDrawerId, dto.cashDrawerId),
          eq(cashDrawerSessions.cashierUserId, dto.cashierUserId),
          eq(cashDrawerSessions.status, 'open'),
        ),
      );
    if (Number(existing?.count ?? 0) > 0) {
      throw new BadRequestException(
        'Cashier already has an open session on this drawer',
      );
    }

    const openingFloat = new Decimal(dto.openingFloat ?? drawer.startingFloat).toFixed(2);

    const [session] = await this.db
      .insert(cashDrawerSessions)
      .values({
        propertyId: dto.propertyId,
        cashDrawerId: dto.cashDrawerId,
        cashierUserId: dto.cashierUserId,
        status: 'open',
        openingFloat,
      })
      .returning();

    await this.webhookService.emit(
      'cashdrawer.session_opened',
      'cash_drawer_session',
      session.id,
      { cashDrawerId: session.cashDrawerId, cashierUserId: session.cashierUserId, openingFloat },
      session.propertyId,
    );
    return session;
  }

  /**
   * Record a cash movement on an open session (KB 12.3).
   */
  async recordMovement(sessionId: string, dto: RecordMovementDto) {
    const session = await this.findSessionById(sessionId, dto.propertyId);
    if (session.status !== 'open') {
      throw new BadRequestException('Cannot record a movement on a closed session');
    }

    // FK ownership (security audit follow-on): the cashier could pass a
    // reservationId belonging to another property, attributing the movement
    // (and any downstream reporting / audit trail) cross-tenant.
    if (dto.reservationId) {
      const [r] = await this.db
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, dto.reservationId), eq(reservations.propertyId, dto.propertyId)));
      if (!r) {
        throw new BadRequestException(`reservation ${dto.reservationId} not found in this property`);
      }
    }

    const [movement] = await this.db
      .insert(cashMovements)
      .values({
        propertyId: dto.propertyId,
        sessionId,
        type: dto.type as 'payment' | 'refund' | 'paid_out' | 'drop',
        amount: new Decimal(dto.amount).toFixed(2),
        reservationId: dto.reservationId,
        note: dto.note,
        createdBy: dto.createdBy,
      })
      .returning();

    await this.webhookService.emit(
      'cashdrawer.movement_recorded',
      'cash_movement',
      movement.id,
      { sessionId, type: movement.type, amount: movement.amount },
      movement.propertyId,
    );
    return movement;
  }

  /**
   * Compute expected balance = opening_float + Σpayment − Σrefund − Σpaid_out − Σdrop
   * over the session's movements (KB 12.4).
   */
  private async computeExpectedBalance(
    session: any,
    propertyId: string,
    tx?: any,
  ): Promise<Decimal> {
    const db = tx ?? this.db;
    const rows = await db
      .select({
        type: cashMovements.type,
        total: sql<string>`coalesce(sum(${cashMovements.amount}::numeric), 0)`,
      })
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.sessionId, session.id),
          eq(cashMovements.propertyId, propertyId),
        ),
      )
      .groupBy(cashMovements.type);

    let expected = new Decimal(session.openingFloat);
    for (const row of rows) {
      const amount = new Decimal(row.total);
      if (row.type === 'payment') expected = expected.plus(amount);
      else expected = expected.minus(amount); // refund, paid_out, drop
    }
    return expected;
  }

  /**
   * Close a session (KB 12.4). Optionally records a final drop, computes the
   * expected balance, and the variance (counted − expected).
   */
  async closeSession(id: string, dto: CloseSessionDto) {
    return this.db.transaction(async (tx: any) => {
      const session = await this.findSessionById(id, dto.propertyId, tx);
      if (session.status !== 'open') {
        throw new BadRequestException('Session is already closed');
      }

      // Optional final drop at close — recorded as a movement (KB 12.3).
      if (dto.dropAmount && new Decimal(dto.dropAmount).gt(0)) {
        await tx.insert(cashMovements).values({
          propertyId: dto.propertyId,
          sessionId: id,
          type: 'drop',
          amount: new Decimal(dto.dropAmount).toFixed(2),
          note: 'Final drop at shift close',
        });
      }

      const expected = await this.computeExpectedBalance(session, dto.propertyId, tx);
      const counted = new Decimal(dto.countedBalance);
      const variance = counted.minus(expected);

      const [updated] = await tx
        .update(cashDrawerSessions)
        .set({
          status: 'closed',
          expectedBalance: expected.toFixed(2),
          countedBalance: counted.toFixed(2),
          variance: variance.toFixed(2),
          closedAt: new Date(),
        })
        .where(
          and(eq(cashDrawerSessions.id, id), eq(cashDrawerSessions.propertyId, dto.propertyId)),
        )
        .returning();

      await this.webhookService.emit(
        'cashdrawer.session_closed',
        'cash_drawer_session',
        updated.id,
        {
          expectedBalance: updated.expectedBalance,
          countedBalance: updated.countedBalance,
          variance: updated.variance,
        },
        updated.propertyId,
      );
      return updated;
    });
  }

  /**
   * Assemble a cashier's report for a session (KB 12.4): session details,
   * movement summary by type, drops, expected vs counted, variance.
   */
  async cashierReport(id: string, propertyId: string) {
    const session = await this.findSessionById(id, propertyId);

    const rows = await this.db
      .select({
        type: cashMovements.type,
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${cashMovements.amount}::numeric), 0)`,
      })
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.sessionId, id),
          eq(cashMovements.propertyId, propertyId),
        ),
      )
      .groupBy(cashMovements.type);

    const movementSummary: Record<string, { count: number; total: string }> = {
      payment: { count: 0, total: '0.00' },
      refund: { count: 0, total: '0.00' },
      paid_out: { count: 0, total: '0.00' },
      drop: { count: 0, total: '0.00' },
    };
    for (const row of rows) {
      movementSummary[row.type] = {
        count: row.count,
        total: new Decimal(row.total).toFixed(2),
      };
    }

    // For an open session, expected is computed live; for a closed session use
    // the persisted value.
    const expected =
      session.status === 'closed' && session.expectedBalance != null
        ? new Decimal(session.expectedBalance)
        : await this.computeExpectedBalance(session, propertyId);

    return {
      session: {
        id: session.id,
        cashDrawerId: session.cashDrawerId,
        cashierUserId: session.cashierUserId,
        status: session.status,
        openingFloat: new Decimal(session.openingFloat).toFixed(2),
        openedAt: session.openedAt,
        closedAt: session.closedAt,
      },
      movementSummary,
      drops: movementSummary['drop'],
      expectedBalance: expected.toFixed(2),
      countedBalance: session.countedBalance != null ? new Decimal(session.countedBalance).toFixed(2) : null,
      variance: session.variance != null ? new Decimal(session.variance).toFixed(2) : null,
    };
  }
}
