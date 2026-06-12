import { pgTable, uuid, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { reservations } from './reservation.js';
import { folios, chargeTypeEnum } from './folio.js';

/**
 * Split-folio routing rules (KB 14.2).
 *
 * A reservation may have multiple folios to separate billing responsibility
 * (e.g. room+tax → company folio, incidentals → guest folio). Routing rules
 * decide, by charge TYPE, which folio a charge posts to by default. The highest
 * `priority` matching rule for a given reservation + charge type wins.
 */
export const folioTargetRoleEnum = pgEnum('folio_target_role', [
  'guest',
  'company',
]);

export const folioRoutingRules = pgTable('folio_routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id),

  chargeType: chargeTypeEnum('charge_type').notNull(),
  targetFolioId: uuid('target_folio_id').notNull().references(() => folios.id),
  priority: integer('priority').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
