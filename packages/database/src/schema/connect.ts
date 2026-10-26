import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  jsonb,
  integer,
  text,
  numeric,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Agent Webhook Subscriptions — OTAIP agents subscribe to PMS events.
 * Subscription system for real-time event delivery to external agents.
 */
export const agentWebhookSubscriptions = pgTable('agent_webhook_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  subscriberId: varchar('subscriber_id', { length: 100 }).notNull(),
  subscriberName: varchar('subscriber_name', { length: 200 }),
  callbackUrl: varchar('callback_url', { length: 500 }).notNull(),

  // Which events to receive
  events: jsonb('events').$type<string[]>().notNull(),

  // Authentication
  secret: varchar('secret', { length: 200 }),

  // State
  isActive: boolean('is_active').notNull().default(true),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastDeliveryStatus: varchar('last_delivery_status', { length: 20 }),
  failureCount: integer('failure_count').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Webhook delivery status.
 */
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'delivered',
  'failed',
]);

/**
 * Webhook Deliveries — one row per (event, subscription) pair.
 * Tracks delivery attempts with retry schedule and HMAC-signed POSTs.
 */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  subscriptionId: uuid('subscription_id').notNull().references(() => agentWebhookSubscriptions.id),
  logicalEventId: uuid('logical_event_id'),

  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),

  status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  lastStatusCode: integer('last_status_code'),
  lastError: text('last_error'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (table) => ({
  propertySubscriptionLogicalEventUnique:
    uniqueIndex('webhook_deliveries_property_subscription_logical_event_unique')
      .on(table.propertyId, table.subscriptionId, table.logicalEventId),
}));

/**
 * Connect API credentials — tenant-bound API keys for the /api/v1/connect/* surface.
 *
 * Each row binds an opaque API key (stored as sha256 hash — NEVER plaintext) to a
 * single propertyId. The ApiKeyGuard hashes the presented key and looks it up here;
 * if found the request runs in scope='property' (cross-tenant denied by ConnectScopeGuard).
 * The legacy `CONNECT_API_KEY` env var is still accepted as scope='platform' for
 * trusted server-side callers (the demo gateway) and may target any tenant by design.
 */
export const connectCredentials = pgTable('connect_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  label: varchar('label', { length: 200 }).notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  // sha256(raw key), hex-encoded. Raw key shown to the operator ONCE on creation.
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** Hosted payment session for Connect agent / LLM bookings. */
export type ConnectPaymentMode = 'charge' | 'authorize' | 'guarantee';
export type ConnectPaymentSessionStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'voided';

export const connectPaymentSessions = pgTable('connect_payment_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  confirmationNumber: varchar('confirmation_number', { length: 64 }).notNull(),
  reservationId: uuid('reservation_id').notNull(),
  bookingId: uuid('booking_id').notNull(),
  folioId: uuid('folio_id'),
  paymentId: uuid('payment_id'),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  paymentMode: varchar('payment_mode', { length: 20 }).$type<ConnectPaymentMode>().notNull(),
  status: varchar('status', { length: 20 }).$type<ConnectPaymentSessionStatus>().notNull().default('pending'),
  psp: varchar('psp', { length: 40 }).notNull(),
  pspSessionId: varchar('psp_session_id', { length: 200 }),
  paymentUrl: text('payment_url'),
  depositAmount: numeric('deposit_amount', { precision: 12, scale: 2 }).notNull().default('0.00'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull().default('EUR'),
  clientPlatform: varchar('client_platform', { length: 40 }),
  pspEventIds: jsonb('psp_event_ids').$type<string[]>().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyUnique: uniqueIndex('connect_payment_sessions_idempotency_uq')
    .on(table.propertyId, table.idempotencyKey),
  confirmationUnique: uniqueIndex('connect_payment_sessions_confirmation_uq')
    .on(table.confirmationNumber),
}));
