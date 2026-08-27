import { jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import type {
  BookingFormQuestionDefinition,
  BookingMode,
  PaymentMethodCollection,
} from '@telivityhaip/database';

/**
 * Local extension of core's `booking_engine_config` table (see
 * `@telivityhaip/database` `schema/booking-engine.ts`) declaring the
 * `booking_mode` / `payment_method_collection` / `form_questions` columns
 * this package owns via its own migration (`0022_booking_requests.sql`).
 *
 * Core's push-schema and Drizzle schema intentionally do NOT declare these
 * columns — they physically exist only once this package's migrations have
 * run (`HAIP_BOOKING_REQUESTS=true` deployments). Mirrors the primary key +
 * `property_id` of the core table so this package can select/update the same
 * physical row through one Drizzle table reference that also knows about
 * these three columns; see `../../module/booking-request-config-fields.port.ts`.
 */
export const bookingEngineConfigRequestFields = pgTable('booking_engine_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().unique(),
  bookingMode: varchar('booking_mode', { length: 10 }).$type<BookingMode>().notNull().default('instant'),
  paymentMethodCollection: varchar('payment_method_collection', { length: 10 })
    .$type<PaymentMethodCollection>()
    .notNull()
    .default('disabled'),
  formQuestions: jsonb('form_questions')
    .$type<BookingFormQuestionDefinition[]>()
    .notNull()
    .default([]),
});
