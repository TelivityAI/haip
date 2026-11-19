import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { auditLogs, ratePlans, rateRestrictions, ariSyncLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

/** Keys that could carry a channel credential inside a sync-log payload. */
const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '***redacted***' : redact(v, depth + 1);
  }
  return out;
}

export interface RateOverrideQuery {
  propertyId: string;
  from?: string;
  to?: string;
  ratePlanId?: string;
  limit?: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rate-override history: which nights carry a manual rate, and what changed them.
 *
 * Three sources, one answer:
 * - `rate_restrictions.rate_override` — the override in force right now
 * - `audit_logs` on rate plans / restrictions — the history of who changed what
 * - `ari_sync_logs` — what was actually pushed to channels, for the same window
 */
@Injectable()
export class RateOverridesReportService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async getRateOverrides(query: RateOverrideQuery) {
    for (const [name, value] of Object.entries({ from: query.from, to: query.to })) {
      if (value && !ISO_DATE_RE.test(value)) {
        throw new BadRequestException(`${name} must be YYYY-MM-DD`);
      }
    }
    const from = query.from ?? '1970-01-01';
    const to = query.to ?? '2999-12-31';
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));

    const planRows = (await this.db
      .select({ id: ratePlans.id, name: ratePlans.name, code: ratePlans.code })
      .from(ratePlans)
      .where(eq(ratePlans.propertyId, query.propertyId))) as Array<{
      id: string;
      name: string;
      code: string;
    }>;
    const planById = new Map(planRows.map((p) => [p.id, p]));

    const restrictionConditions: unknown[] = [
      eq(rateRestrictions.propertyId, query.propertyId),
      isNotNull(rateRestrictions.rateOverride),
      lte(rateRestrictions.startDate, to),
      gte(rateRestrictions.endDate, from),
    ];
    if (query.ratePlanId) {
      restrictionConditions.push(eq(rateRestrictions.ratePlanId, query.ratePlanId));
    }

    const activeOverrides = (await this.db
      .select({
        restrictionId: rateRestrictions.id,
        ratePlanId: rateRestrictions.ratePlanId,
        startDate: rateRestrictions.startDate,
        endDate: rateRestrictions.endDate,
        rateOverride: rateRestrictions.rateOverride,
        isClosed: rateRestrictions.isClosed,
        updatedAt: rateRestrictions.updatedAt,
      })
      .from(rateRestrictions)
      .where(and(...(restrictionConditions as Parameters<typeof and>)))
      .orderBy(desc(rateRestrictions.startDate))
      .limit(limit)) as Array<Record<string, unknown>>;

    const auditRows = (await this.db
      .select({
        id: auditLogs.id,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        action: auditLogs.action,
        userEmail: auditLogs.userEmail,
        occurredAt: auditLogs.occurredAt,
        previousValue: auditLogs.previousValue,
        newValue: auditLogs.newValue,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.propertyId, query.propertyId),
          inArray(auditLogs.entityType, ['rate_plan', 'rate_restriction']),
          gte(auditLogs.occurredAt, new Date(`${from}T00:00:00.000Z`)),
          lte(auditLogs.occurredAt, new Date(`${to}T23:59:59.999Z`)),
        ),
      )
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit)) as Array<Record<string, unknown>>;

    // Channel pushes for the same window, so "did the override reach the OTA?" is
    // answerable from the same report. Payloads are redacted, never raw.
    const relevantPlanIds = query.ratePlanId
      ? [query.ratePlanId]
      : [...new Set(activeOverrides.map((r) => String(r['ratePlanId'] ?? '')))].filter(Boolean);

    const syncConditions: unknown[] = [
      eq(ariSyncLogs.propertyId, query.propertyId),
      gte(ariSyncLogs.createdAt, new Date(`${from}T00:00:00.000Z`)),
      lte(ariSyncLogs.createdAt, new Date(`${to}T23:59:59.999Z`)),
    ];
    if (relevantPlanIds.length > 0) {
      syncConditions.push(inArray(ariSyncLogs.ratePlanId, relevantPlanIds));
    }

    const syncRows = (await this.db
      .select({
        id: ariSyncLogs.id,
        action: ariSyncLogs.action,
        status: ariSyncLogs.status,
        ratePlanId: ariSyncLogs.ratePlanId,
        dateRangeStart: ariSyncLogs.dateRangeStart,
        dateRangeEnd: ariSyncLogs.dateRangeEnd,
        errorMessage: ariSyncLogs.errorMessage,
        createdAt: ariSyncLogs.createdAt,
        response: ariSyncLogs.response,
      })
      .from(ariSyncLogs)
      .where(and(...(syncConditions as Parameters<typeof and>)))
      .orderBy(desc(ariSyncLogs.createdAt))
      .limit(limit)) as Array<Record<string, unknown>>;

    return {
      window: { from: query.from ?? null, to: query.to ?? null },
      activeOverrideCount: activeOverrides.length,
      activeOverrides: activeOverrides.map((row) => ({
        restrictionId: row['restrictionId'],
        ratePlanId: row['ratePlanId'],
        ratePlanName: planById.get(String(row['ratePlanId']))?.name ?? null,
        ratePlanCode: planById.get(String(row['ratePlanId']))?.code ?? null,
        startDate: String(row['startDate'] ?? '').slice(0, 10),
        endDate: String(row['endDate'] ?? '').slice(0, 10),
        rateOverride: row['rateOverride'],
        isClosed: row['isClosed'],
        updatedAt: row['updatedAt'],
      })),
      historyCount: auditRows.length,
      history: auditRows.map((row) => ({
        id: row['id'],
        entityType: row['entityType'],
        entityId: row['entityId'],
        action: row['action'],
        userEmail: row['userEmail'] ?? null,
        occurredAt: row['occurredAt'],
        previousValue: redact(row['previousValue']),
        newValue: redact(row['newValue']),
      })),
      channelPushCount: syncRows.length,
      channelPushes: syncRows.map((row) => ({
        id: row['id'],
        action: row['action'],
        status: row['status'],
        ratePlanId: row['ratePlanId'],
        dateRangeStart: row['dateRangeStart'],
        dateRangeEnd: row['dateRangeEnd'],
        errorMessage: row['errorMessage'] ?? null,
        createdAt: row['createdAt'],
        response: redact(row['response']),
      })),
      note:
        'activeOverrides = manual rates in force for this window. history = recorded rate-plan and ' +
        'restriction changes (who/when). channelPushes = what was sent to OTAs — a push alone does not ' +
        'prove the channel applied it.',
    };
  }
}
