/**
 * HAIP Database Schema — All core entities.
 *
 * Domain knowledge source: kb/HAIP_KNOWLEDGE_BASE.md
 * DO NOT INVENT HOTEL DOMAIN LOGIC.
 */

// Property
export { properties } from './property.js';

// Media (images for property / room types / rooms)
export { mediaOwnerTypeEnum, mediaCategoryEnum, media } from './media.js';

// RBAC — local users, roles, permissions (local authz + Keycloak login)
export {
  userStatusEnum,
  users,
  roles,
  rolePermissions,
  userRoles,
} from './rbac.js';

// Rooms & Room Types
export { roomStatusEnum, roomTypes, rooms } from './room.js';

// Guests
export { vipLevelEnum, guests } from './guest.js';

// Reservations & Bookings
export {
  reservationStatusEnum,
  bookingSourceEnum,
  bookings,
  reservations,
  reservationNotes,
} from './reservation.js';

// Rate Plans & Restrictions
export {
  ratePlanTypeEnum,
  ratePlans,
  rateRestrictions,
} from './rate-plan.js';

// Folios, Charges & Payments
export {
  folioTypeEnum,
  folioStatusEnum,
  folios,
  chargeTypeEnum,
  charges,
  paymentMethodEnum,
  paymentStatusEnum,
  payments,
} from './folio.js';

// Housekeeping
export {
  housekeepingTaskStatusEnum,
  housekeepingTaskTypeEnum,
  housekeepingTasks,
} from './housekeeping.js';

// Audit
export {
  auditRunStatusEnum,
  auditRuns,
  auditLogs,
} from './audit.js';

// Channel Manager
export {
  channelStatusEnum,
  syncDirectionEnum,
  channelConnections,
  ariSyncLogs,
  contentSyncLogs,
} from './channel.js';

// Connect / Agent Subscriptions
export {
  agentWebhookSubscriptions,
  webhookDeliveryStatusEnum,
  webhookDeliveries,
  connectCredentials,
} from './connect.js';

// Tax
export {
  taxProfiles,
  taxRuleTypeEnum,
  taxRules,
} from './tax.js';

// AI Agents
export {
  agentTypeEnum,
  agentModeEnum,
  agentDecisionStatusEnum,
  agentConfigs,
  agentDecisions,
  agentTrainingSnapshots,
} from './agent.js';

// Guest Reviews
export {
  reviewSourceEnum,
  reviewResponseStatusEnum,
  guestReviews,
} from './review.js';

// Deposit Ledger (KB 10)
export {
  depositStatusEnum,
  depositLedgerEntries,
} from './deposit.js';

// Accounts Receivable (KB 11)
export {
  arLedgerStatusEnum,
  arTxnTypeEnum,
  arLedgers,
  arTransactions,
} from './accounts-receivable.js';

// Cash Drawer / Cashiering (KB 12)
export {
  cashSessionStatusEnum,
  cashMovementTypeEnum,
  cashDrawers,
  cashDrawerSessions,
  cashMovements,
} from './cash-drawer.js';

// Custom Accounting / GL Codes (KB 5)
export {
  accountingCodeKindEnum,
  accountingCodes,
} from './accounting-code.js';

// House Accounts & Products (KB 13)
export {
  houseAccountKindEnum,
  houseAccountStatusEnum,
  houseAccounts,
  products,
} from './house-account.js';

// Split-folio routing rules (KB 14.2)
export {
  folioTargetRoleEnum,
  folioRoutingRules,
} from './folio-routing.js';

// Groups & Allotment Engine (KB 14.3–14.7)
export {
  groupTypeEnum,
  blockStatusEnum,
  roomingListEntryStatusEnum,
  groupProfiles,
  allotmentBlocks,
  allotmentBlockInventory,
  roomingListEntries,
} from './group.js';
