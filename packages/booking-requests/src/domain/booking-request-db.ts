/**
 * Combined Drizzle symbols for the booking-requests module.
 *
 * `auditLogs` is deliberately re-exported LAST and by name: core's plain
 * `audit_logs` table (from `@telivityhaip/database`) does not declare the
 * `booking_request_id` column or its timeline index — those are this
 * package's own DDL (see `database/migrations/0029_…`, `0032_…` and
 * `database/schema/audit.ts`). The explicit named export below shadows the
 * star-exported core `auditLogs` so every domain file in this package that
 * imports `auditLogs` from here gets the package's extended table (same
 * physical row, `bookingRequestId`-aware Drizzle columns).
 */
export * from '@telivityhaip/database';
export * from '../database/schema/index.js';
export { bookingRequestAuditLogs as auditLogs } from '../database/schema/audit.js';
