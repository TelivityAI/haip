import { pgTable, uuid, varchar, text, boolean, numeric, jsonb, timestamp, date, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

export const agentTypeEnum = pgEnum('agent_type', [
  'pricing',
  'demand_forecast',
  'channel_mix',
  'overbooking',
  'night_audit',
  'housekeeping',
  'cancellation',
  'guest_comms',
  'review_response',
  'ar_collections',
  'deposit_risk',
  'group_pickup',
  'revenue_manager',
]);

export const agentModeEnum = pgEnum('agent_mode', [
  'manual',
  'suggest',
  'autopilot',
]);

export const agentDecisionStatusEnum = pgEnum('agent_decision_status', [
  'pending',
  'approved',
  'rejected',
  'auto_executed',
  'expired',
]);

/**
 * Per-property, per-agent-type configuration.
 * Controls mode (manual/suggest/autopilot), thresholds, and trained model state.
 */
export const agentConfigs = pgTable('agent_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id),
  agentType: agentTypeEnum('agent_type').notNull(),
  isEnabled: boolean('is_enabled').default(false).notNull(),
  mode: agentModeEnum('mode').default('suggest').notNull(),
  autopilotConfidenceThreshold: numeric('autopilot_confidence_threshold', {
    precision: 3,
    scale: 2,
  }).default('0.85'),
  config: jsonb('config').default({}),
  modelState: jsonb('model_state').default({}),
  lastTrainedAt: timestamp('last_trained_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniquePropertyAgent: uniqueIndex('agent_configs_property_agent_unique')
    .on(table.propertyId, table.agentType),
}));

/**
 * Every recommendation/action an agent makes.
 * Decision log with input snapshot, recommendation, confidence, and outcome.
 */
export const agentDecisions = pgTable('agent_decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id),
  agentType: agentTypeEnum('agent_type').notNull(),
  decisionType: varchar('decision_type', { length: 100 }).notNull(),
  inputSnapshot: jsonb('input_snapshot').default({}),
  recommendation: jsonb('recommendation').default({}),
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
  status: agentDecisionStatusEnum('status').default('pending').notNull(),
  approvedBy: uuid('approved_by'),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  outcome: jsonb('outcome'),
  outcomeRecordedAt: timestamp('outcome_recorded_at', { withTimezone: true }),
  // HAIP AI's grounded rationale + suggestions for this decision. Generated on
  // demand (only for decisions a human reviews) and cached here. null = not yet
  // explained or the model was unavailable (UI falls back to the raw decision).
  explanation: jsonb('explanation'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Periodic snapshots of property data for model retraining.
 */
export const agentTrainingSnapshots = pgTable('agent_training_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id),
  agentType: agentTypeEnum('agent_type').notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  data: jsonb('data').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
