import { pgTable, uuid, varchar, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { reservations } from './reservation.js';
import { rooms } from './room.js';

/** Door-lock credential lifecycle — active while guest is checked in. */
export const doorLockCredentialStatusEnum = pgEnum('door_lock_credential_status', [
  'active',
  'revoked',
]);

/**
 * Persisted room-access credentials issued by the lock provider (webhook adapter
 * or future vendor SDK). One row per reservation; reissue updates the code.
 */
export const doorLockCredentials = pgTable(
  'door_lock_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    reservationId: uuid('reservation_id').notNull().references(() => reservations.id),
    roomId: uuid('room_id').references(() => rooms.id),
    provider: varchar('provider', { length: 50 }).notNull(),
    credentialId: varchar('credential_id', { length: 100 }).notNull(),
    accessCode: varchar('access_code', { length: 20 }),
    status: doorLockCredentialStatusEnum('status').notNull().default('active'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    propertyReservationUnique: uniqueIndex('door_lock_credentials_property_reservation_unique').on(
      table.propertyId,
      table.reservationId,
    ),
  }),
);
