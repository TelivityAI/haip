import { Injectable, Inject } from '@nestjs/common';
import { eq, and, sql, lte, gte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  charges,
  payments,
  reservations,
  folios,
  auditRuns,
  properties,
  rooms,
  depositLedgerEntries,
  arLedgers,
  arTransactions,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { reportPaymentSumWhere } from '../payment/payment-ledger';

@Injectable()
export class ReportsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Daily Revenue Report — sums charges by type and payments by method for a date.
   */
  async getDailyRevenue(propertyId: string, date: string) {
    // Revenue by charge type
    const revenueByType = await this.db
      .select({
        type: charges.type,
        total: sql<string>`coalesce(sum(${charges.amount}::numeric), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.isReversal, false),
          sql`${charges.serviceDate}::date = ${date}`,
        ),
      )
      .groupBy(charges.type);

    // Adjustments (reversals)
    const [adjResult] = await this.db
      .select({
        total: sql<string>`coalesce(sum(abs(${charges.amount}::numeric)), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.isReversal, true),
          sql`${charges.serviceDate}::date = ${date}`,
        ),
      );

    // Payments by method
    const paymentsByMethod = await this.db
      .select({
        method: payments.method,
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(
        and(
          reportPaymentSumWhere(propertyId),
          sql`${payments.processedAt}::date = ${date}`,
        ),
      )
      .groupBy(payments.method);

    // Build revenue object — accumulate as Decimal, expose as number at boundary
    const revenueDec = {
      room: new Decimal(0),
      tax: new Decimal(0),
      foodBeverage: new Decimal(0),
      other: new Decimal(0),
      total: new Decimal(0),
    };
    for (const row of revenueByType) {
      const amount = new Decimal(row.total);
      if (row.type === 'room') revenueDec.room = revenueDec.room.plus(amount);
      else if (row.type === 'tax') revenueDec.tax = revenueDec.tax.plus(amount);
      else if (row.type === 'food_beverage') revenueDec.foodBeverage = revenueDec.foodBeverage.plus(amount);
      else revenueDec.other = revenueDec.other.plus(amount);
      revenueDec.total = revenueDec.total.plus(amount);
    }
    const revenue = {
      room: revenueDec.room.toNumber(),
      tax: revenueDec.tax.toNumber(),
      foodBeverage: revenueDec.foodBeverage.toNumber(),
      other: revenueDec.other.toNumber(),
      total: revenueDec.total.toNumber(),
    };

    // Build payments object
    const paymentsObj: Record<string, number> = {};
    let paymentsTotalDec = new Decimal(0);
    for (const row of paymentsByMethod) {
      const amount = new Decimal(row.total);
      paymentsObj[row.method] = amount.toNumber();
      paymentsTotalDec = paymentsTotalDec.plus(amount);
    }

    const adjustmentsDec = new Decimal(adjResult?.total ?? '0');

    return {
      date,
      revenue,
      payments: { ...paymentsObj, total: paymentsTotalDec.toNumber() },
      adjustments: adjustmentsDec.toNumber(),
      netRevenue: revenueDec.total.minus(adjustmentsDec).toNumber(),
    };
  }

  /**
   * Occupancy Report — room occupancy metrics for a date (KB 5.9).
   */
  async getOccupancy(propertyId: string, date: string) {
    // Property total rooms
    const [property] = await this.db
      .select({ totalRooms: properties.totalRooms })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const totalRooms = property?.totalRooms ?? 0;

    // Room status counts
    const roomStatusCounts = await this.db
      .select({
        status: rooms.status,
        count: sql<number>`count(*)::int`,
      })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.isActive, true)))
      .groupBy(rooms.status);

    let outOfOrder = 0;
    let outOfService = 0;
    let occupiedRooms = 0;
    for (const row of roomStatusCounts) {
      if (row.status === 'out_of_order') outOfOrder = row.count;
      else if (row.status === 'out_of_service') outOfService = row.count;
      else if (row.status === 'occupied') occupiedRooms = row.count;
    }

    const availableRooms = totalRooms - outOfOrder - outOfService;
    const occupancyRate = availableRooms > 0 ? occupiedRooms / availableRooms : 0;

    // Arrivals (checked in today)
    const [arrivalsResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.checkedInAt}::date = ${date}`,
        ),
      );

    // Departures (checked out today)
    const [departuresResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.checkedOutAt}::date = ${date}`,
        ),
      );

    // Stayovers (in-house continuing)
    const [stayoversResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.status} in ('stayover', 'checked_in', 'due_out')`,
          lte(reservations.arrivalDate, date),
        ),
      );

    // No-shows
    const [noShowsResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'no_show' as any),
          eq(reservations.arrivalDate, date),
        ),
      );

    // Cancellations
    const [cancelsResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'cancelled' as any),
          sql`${reservations.cancelledAt}::date = ${date}`,
        ),
      );

    return {
      date,
      totalRooms,
      outOfOrder,
      outOfService,
      availableRooms,
      occupiedRooms,
      occupancyRate: Math.round(occupancyRate * 10000) / 10000,
      occupancyPercent: `${(occupancyRate * 100).toFixed(1)}%`,
      arrivals: arrivalsResult?.count ?? 0,
      departures: departuresResult?.count ?? 0,
      stayovers: stayoversResult?.count ?? 0,
      noShows: noShowsResult?.count ?? 0,
      cancellations: cancelsResult?.count ?? 0,
    };
  }

  /**
   * Financial Summary (Manager's Report) — daily KPIs (KB 5.9).
   * ADR = room revenue / rooms sold
   * RevPAR = ADR x occupancy rate
   */
  async getFinancialSummary(propertyId: string, date: string) {
    // Room revenue
    const [roomRevenueResult] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${charges.amount}::numeric), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.type, 'room' as any),
          eq(charges.isReversal, false),
          sql`${charges.serviceDate}::date = ${date}`,
        ),
      );
    const roomRevenueDec = new Decimal(roomRevenueResult?.total ?? '0');
    const roomRevenue = roomRevenueDec.toNumber();

    // Total revenue
    const [totalRevenueResult] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${charges.amount}::numeric), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.isReversal, false),
          sql`${charges.serviceDate}::date = ${date}`,
        ),
      );
    const totalRevenue = new Decimal(totalRevenueResult?.total ?? '0').toNumber();

    // Revenue by type
    const revenueByTypeRows = await this.db
      .select({
        type: charges.type,
        total: sql<string>`coalesce(sum(${charges.amount}::numeric), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.isReversal, false),
          sql`${charges.serviceDate}::date = ${date}`,
        ),
      )
      .groupBy(charges.type);

    const revenueByType: Record<string, number> = {};
    for (const row of revenueByTypeRows) {
      revenueByType[row.type] = new Decimal(row.total).toNumber();
    }

    // Payments by method
    const paymentRows = await this.db
      .select({
        method: payments.method,
        total: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(
        and(
          reportPaymentSumWhere(propertyId),
          sql`${payments.processedAt}::date = ${date}`,
        ),
      )
      .groupBy(payments.method);

    const paymentsByMethod: Record<string, number> = {};
    for (const row of paymentRows) {
      paymentsByMethod[row.method] = new Decimal(row.total).toNumber();
    }

    // Rooms sold
    const [roomsSoldResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.status} in ('checked_in', 'stayover', 'due_out')`,
          lte(reservations.arrivalDate, date),
        ),
      );
    const roomsSold = roomsSoldResult?.count ?? 0;

    // Property totals + OOO/OOS
    const [property] = await this.db
      .select({ totalRooms: properties.totalRooms })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const totalRooms = property?.totalRooms ?? 0;

    const roomStatusCounts = await this.db
      .select({
        status: rooms.status,
        count: sql<number>`count(*)::int`,
      })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.isActive, true)))
      .groupBy(rooms.status);

    let unavailableRooms = 0;
    for (const row of roomStatusCounts) {
      if (row.status === 'out_of_order' || row.status === 'out_of_service') {
        unavailableRooms += row.count;
      }
    }

    const availableRooms = totalRooms - unavailableRooms;
    const occupancyRate = availableRooms > 0 ? roomsSold / availableRooms : 0;
    // ADR / RevPAR are displayed as currency — compute via Decimal to avoid drift
    const adrDec = roomsSold > 0 ? roomRevenueDec.div(roomsSold) : new Decimal(0);
    const revparDec = adrDec.times(occupancyRate);
    const adr = adrDec.toNumber();
    const revpar = revparDec.toNumber();

    // Outstanding balances
    const [outstandingResult] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        totalBalance: sql<string>`coalesce(sum(${folios.balance}::numeric), 0)`,
      })
      .from(folios)
      .where(
        and(
          eq(folios.propertyId, propertyId),
          eq(folios.status, 'open' as any),
        ),
      );

    // Last audit
    const [lastAudit] = await this.db
      .select()
      .from(auditRuns)
      .where(eq(auditRuns.propertyId, propertyId))
      .orderBy(sql`${auditRuns.businessDate} desc`)
      .limit(1);

    return {
      date,
      kpis: {
        adr: Math.round(adr * 100) / 100,
        revpar: Math.round(revpar * 100) / 100,
        occupancyRate: Math.round(occupancyRate * 10000) / 10000,
        totalRevenue,
        roomRevenue,
      },
      revenueByType,
      paymentsByMethod,
      outstandingBalances: {
        totalFoliosOpen: outstandingResult?.count ?? 0,
        totalBalanceDue: new Decimal(outstandingResult?.totalBalance ?? '0').toNumber(),
      },
      auditStatus: {
        lastAuditDate: lastAudit?.businessDate ?? null,
        lastAuditStatus: lastAudit?.status ?? null,
        errorsInLastAudit: lastAudit?.errors?.length ?? 0,
      },
    };
  }

  /**
   * Occupancy Trend Report — daily metrics over a date range (KB 5.9).
   */
  async getOccupancyTrend(propertyId: string, startDate: string, endDate: string) {
    // Property info
    const [property] = await this.db
      .select({ totalRooms: properties.totalRooms })
      .from(properties)
      .where(eq(properties.id, propertyId));
    const totalRooms = property?.totalRooms ?? 0;

    // OOO/OOS (snapshot — same for all dates in MVP)
    const roomStatusCounts = await this.db
      .select({
        status: rooms.status,
        count: sql<number>`count(*)::int`,
      })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.isActive, true)))
      .groupBy(rooms.status);

    let unavailableRooms = 0;
    for (const row of roomStatusCounts) {
      if (row.status === 'out_of_order' || row.status === 'out_of_service') {
        unavailableRooms += row.count;
      }
    }
    const availableRooms = totalRooms - unavailableRooms;

    // Room revenue per day
    const dailyRevenue = await this.db
      .select({
        date: sql<string>`${charges.serviceDate}::date`,
        revenue: sql<string>`coalesce(sum(${charges.amount}::numeric), 0)`,
      })
      .from(charges)
      .where(
        and(
          eq(charges.propertyId, propertyId),
          eq(charges.type, 'room' as any),
          eq(charges.isReversal, false),
          sql`${charges.serviceDate}::date >= ${startDate}`,
          sql`${charges.serviceDate}::date <= ${endDate}`,
        ),
      )
      .groupBy(sql`${charges.serviceDate}::date`);

    // Rooms sold per day (reservations in-house for each date)
    const dailyRoomsSold = await this.db
      .select({
        date: sql<string>`d.d::date`,
        count: sql<number>`count(distinct r.id)::int`,
      })
      .from(sql`generate_series(${startDate}::date, ${endDate}::date, '1 day'::interval) as d(d)`)
      .leftJoin(
        reservations,
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.status} in ('checked_in', 'stayover', 'due_out', 'checked_out')`,
          lte(reservations.arrivalDate, sql`d.d::date`),
          sql`${reservations.departureDate} > d.d::date`,
        ),
      )
      .groupBy(sql`d.d::date`)
      .orderBy(sql`d.d::date`);

    // Build lookup maps
    const revenueMap = new Map<string, number>();
    for (const row of dailyRevenue) {
      const dateKey = typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().split('T')[0]!;
      revenueMap.set(dateKey, new Decimal(row.revenue).toNumber());
    }

    // Build daily array
    const daily: Array<{
      date: string;
      occupancyRate: number;
      adr: number;
      revpar: number;
      roomsSold: number;
      revenue: number;
    }> = [];

    let totalRevenue = 0;
    let totalRoomNights = 0;

    for (const row of dailyRoomsSold) {
      const dateKey = typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().split('T')[0]!;
      const roomsSold = row.count;
      const revenue = revenueMap.get(dateKey) ?? 0;
      const occupancyRate = availableRooms > 0 ? roomsSold / availableRooms : 0;
      const adr = roomsSold > 0 ? revenue / roomsSold : 0;
      const revpar = adr * occupancyRate;

      daily.push({
        date: dateKey,
        occupancyRate: Math.round(occupancyRate * 10000) / 10000,
        adr: Math.round(adr * 100) / 100,
        revpar: Math.round(revpar * 100) / 100,
        roomsSold,
        revenue,
      });

      totalRevenue += revenue;
      totalRoomNights += roomsSold;
    }

    const dayCount = daily.length || 1;

    return {
      period: { start: startDate, end: endDate },
      daily,
      summary: {
        avgOccupancy: Math.round(daily.reduce((s, d) => s + d.occupancyRate, 0) / dayCount * 10000) / 10000,
        avgAdr: Math.round(daily.reduce((s, d) => s + d.adr, 0) / dayCount * 100) / 100,
        avgRevpar: Math.round(daily.reduce((s, d) => s + d.revpar, 0) / dayCount * 100) / 100,
        totalRevenue,
        totalRoomNights,
      },
    };
  }

  /**
   * Daily Trial Balance (KB 5, computed — no table).
   *
   * For each ledger (Deposit / Guest(current) / A/R) reports
   * Opening + Net Activity + Transfers In/Out = Closing for the business date.
   * Best-effort aggregation from `deposit_ledger_entries`, `folios`, and
   * `ar_ledgers`/`ar_transactions`. The cross-ledger transfer total (folio →
   * A/R) is surfaced so it can be reconciled to net to zero between ledgers.
   */
  async dailyTrialBalance(propertyId: string, date: string) {
    // --- Deposit ledger (KB 10) ---
    // Opening = held liability received before the date and not yet recognized
    // before the date. Closing = held liability as of end of date.
    const [depositOpeningRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${depositLedgerEntries.amount}::numeric), 0)`,
      })
      .from(depositLedgerEntries)
      .where(
        and(
          eq(depositLedgerEntries.propertyId, propertyId),
          sql`${depositLedgerEntries.receivedAt}::date < ${date}`,
          sql`(${depositLedgerEntries.recognizedAt} is null or ${depositLedgerEntries.recognizedAt}::date >= ${date})`,
        ),
      );

    const [depositReceivedRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${depositLedgerEntries.amount}::numeric), 0)`,
      })
      .from(depositLedgerEntries)
      .where(
        and(
          eq(depositLedgerEntries.propertyId, propertyId),
          sql`${depositLedgerEntries.receivedAt}::date = ${date}`,
        ),
      );

    const [depositRecognizedRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${depositLedgerEntries.amount}::numeric), 0)`,
      })
      .from(depositLedgerEntries)
      .where(
        and(
          eq(depositLedgerEntries.propertyId, propertyId),
          sql`${depositLedgerEntries.recognizedAt}::date = ${date}`,
        ),
      );

    const depositOpening = new Decimal(depositOpeningRow?.total ?? '0');
    const depositReceived = new Decimal(depositReceivedRow?.total ?? '0');
    const depositRecognized = new Decimal(depositRecognizedRow?.total ?? '0');
    // Recognition moves deposits out of the deposit ledger (to guest/revenue).
    const depositNetActivity = depositReceived;
    const depositTransfersOut = depositRecognized;
    const depositClosing = depositOpening.plus(depositReceived).minus(depositRecognized);

    // --- Guest (current) ledger (KB 5.4) — open guest folio balances ---
    const [guestBalanceRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${folios.balance}::numeric), 0)`,
      })
      .from(folios)
      .where(
        and(
          eq(folios.propertyId, propertyId),
          eq(folios.type, 'guest' as any),
          eq(folios.status, 'open' as any),
        ),
      );
    const guestClosing = new Decimal(guestBalanceRow?.total ?? '0');

    // --- A/R ledger (KB 11) ---
    const [arBalanceRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${arLedgers.balance}::numeric), 0)`,
      })
      .from(arLedgers)
      .where(eq(arLedgers.propertyId, propertyId));
    const arClosing = new Decimal(arBalanceRow?.total ?? '0');

    // A/R transfers in on the date (folio → A/R cross-ledger move, KB 11.3).
    const [arTransfersInRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${arTransactions.amount}::numeric), 0)`,
      })
      .from(arTransactions)
      .where(
        and(
          eq(arTransactions.propertyId, propertyId),
          eq(arTransactions.type, 'transfer_in' as any),
          sql`${arTransactions.createdAt}::date = ${date}`,
        ),
      );

    const [arPaymentsRow] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${arTransactions.amount}::numeric), 0)`,
      })
      .from(arTransactions)
      .where(
        and(
          eq(arTransactions.propertyId, propertyId),
          eq(arTransactions.type, 'payment' as any),
          sql`${arTransactions.createdAt}::date = ${date}`,
        ),
      );

    const arTransfersIn = new Decimal(arTransfersInRow?.total ?? '0');
    const arPayments = new Decimal(arPaymentsRow?.total ?? '0');
    const arNetActivity = arPayments.negated();
    const arOpening = arClosing.minus(arTransfersIn).plus(arPayments);

    // Cross-ledger transfer reconciliation: the balance transferred out of the
    // guest ledger should equal the amount transferred into A/R on the date.
    const interLedgerTransfers = arTransfersIn;

    return {
      date,
      ledgers: {
        deposit: {
          opening: depositOpening.toFixed(2),
          netActivity: depositNetActivity.toFixed(2),
          transfersIn: '0.00',
          transfersOut: depositTransfersOut.toFixed(2),
          closing: depositClosing.toFixed(2),
        },
        guest: {
          // Opening/activity for the guest ledger requires per-day folio
          // snapshots not retained here; closing is the live open-folio balance.
          opening: '0.00',
          netActivity: '0.00',
          transfersIn: '0.00',
          transfersOut: interLedgerTransfers.toFixed(2),
          closing: guestClosing.toFixed(2),
        },
        ar: {
          opening: arOpening.toFixed(2),
          netActivity: arNetActivity.toFixed(2),
          transfersIn: arTransfersIn.toFixed(2),
          transfersOut: '0.00',
          closing: arClosing.toFixed(2),
        },
      },
      interLedgerTransfers: interLedgerTransfers.toFixed(2),
    };
  }
}
