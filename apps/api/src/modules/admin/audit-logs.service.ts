import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

export interface AuditLogQuery {
  propertyId: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}

/** Keys whose values must never be echoed back out of an audit row. */
const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|card[_-]?number|pan|cvv|cvc|iban|swift|refresh[_-]?token|access[_-]?token|client[_-]?secret)/i;

/**
 * Recursively mask sensitive values inside an audit payload. Audit rows can carry
 * credential-shaped snapshots (connect credentials, integration keys), and the read
 * route is a general staff surface — redacting here keeps one choke point rather than
 * trusting every writer to have scrubbed before insert.
 */
export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, depth + 1));
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 512) return `${value.slice(0, 512)}…`;
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? '***redacted***' : redactAuditValue(raw, depth + 1);
  }
  return out;
}

/**
 * Read-only access to the GDPR/PCI audit trail. Multi-tenant by construction: the
 * property filter is mandatory and system-level rows (`property_id IS NULL`) are
 * deliberately excluded so one tenant can never read platform events.
 */
@Injectable()
export class AuditLogsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async list(query: AuditLogQuery) {
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const page = Math.max(1, query.page ?? 1);
    const offset = (page - 1) * limit;

    const filters: unknown[] = [eq(auditLogs.propertyId, query.propertyId)];
    if (query.entityType) filters.push(eq(auditLogs.entityType, query.entityType));
    if (query.entityId) filters.push(eq(auditLogs.entityId, query.entityId));
    if (query.action) filters.push(eq(auditLogs.action, query.action));
    if (query.from) filters.push(gte(auditLogs.occurredAt, new Date(`${query.from}T00:00:00.000Z`)));
    if (query.to) filters.push(lte(auditLogs.occurredAt, new Date(`${query.to}T23:59:59.999Z`)));

    const rows = (await this.db
      .select()
      .from(auditLogs)
      .where(and(...(filters as Parameters<typeof and>)))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit)
      .offset(offset)) as Array<Record<string, unknown>>;

    const [countRow] = (await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(...(filters as Parameters<typeof and>)))) as Array<{ count: number }>;

    const total = countRow?.count ?? rows.length;

    return {
      count: rows.length,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
      logs: rows.map((row) => ({
        id: row['id'],
        action: row['action'],
        entityType: row['entityType'],
        entityId: row['entityId'] ?? null,
        userEmail: row['userEmail'] ?? null,
        userId: row['userId'] ?? null,
        description: row['description'] ?? null,
        occurredAt: row['occurredAt'] ?? null,
        previousValue: redactAuditValue(row['previousValue']),
        newValue: redactAuditValue(row['newValue']),
      })),
    };
  }
}
