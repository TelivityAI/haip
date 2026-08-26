import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, date, pgEnum, numeric, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { rooms } from './room.js';
import { roomTypes } from './room.js';
import { guests } from './guest.js';
import { ratePlans } from './rate-plan.js';

/**
 * Reservation status state machine (KB 5.1):
 * Pending → Confirmed → Assigned → Checked In → Stayover → Due Out → Checked Out
 * Also: No-Show (determined 12 AM-2 AM), Cancelled
 */
export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'confirmed',
  'assigned',       // Room assigned but not yet checked in
  'checked_in',
  'stayover',       // Multi-night, currently in-house
  'due_out',        // Checkout date reached
  'checked_out',
  'no_show',
  'cancelled',
]);

/**
 * Booking source — where the reservation originated.
 */
export const bookingSourceEnum = pgEnum('booking_source', [
  'direct',         // Hotel website / booking engine
  'ota',            // OTA via channel manager
  'gds',            // GDS (Amadeus, Sabre, Travelport)
  'phone',          // Phone reservation
  'walk_in',        // Walk-in
  'agent',          // OTAIP agent booking
  'group',          // Group/block booking
  'corporate',      // Corporate portal
]);

export interface AcceptedPricingNight {
  date: string;
  roomAmount: string;
  taxAmount: string;
}

export interface AcceptedPricingServiceNight {
  date: string;
  amount: string;
  taxAmount: string;
}

export interface AcceptedPricingService {
  serviceId: string;
  code: string;
  name: string;
  postingRule: string;
  chargeType: string;
  currencyCode: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  taxTotal: string;
  lineItems: AcceptedPricingServiceNight[];
}

/** Immutable operational tariff chosen when staff accepts a Booking Request. */
export interface AcceptedPricingSnapshot {
  version: 1;
  source: 'submitted' | 'current' | 'custom' | 'prior';
  currencyCode: string;
  grandTotal: string;
  roomTotal: string;
  taxTotal: string;
  nights: AcceptedPricingNight[];
  services: AcceptedPricingService[];
  servicesTotal: string;
  servicesTaxTotal: string;
  customReason: string | null;
  adjustment: null | {
    amount: string;
    reason: string;
    serviceDate: string;
  };
}

/**
 * Bookings — container for one or more reservations; identifies the booker.
 * Booking is the party wrapper; reservations are per-room.
 */
export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  guestId: uuid('guest_id').notNull().references(() => guests.id), // The booker

  confirmationNumber: varchar('confirmation_number', { length: 50 }).notNull().unique(),
  externalConfirmation: varchar('external_confirmation', { length: 100 }), // OTA/GDS confirmation

  source: bookingSourceEnum('source').notNull(),
  channelCode: varchar('channel_code', { length: 50 }), // "booking_com", "expedia", "amadeus"

  // Group booking reference
  groupId: uuid('group_id'), // FK to future groups table
  groupName: varchar('group_name', { length: 255 }),

  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reservations — specific booking for one unit for a date range.
 * Each reservation has its own status, room assignment, and folio.
 */
export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id),
  guestId: uuid('guest_id').notNull().references(() => guests.id), // May differ from booker

  // Dates
  arrivalDate: date('arrival_date').notNull(),
  departureDate: date('departure_date').notNull(),
  nights: integer('nights').notNull(), // Denormalized for query performance

  // Room assignment
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id), // What was booked
  roomId: uuid('room_id').references(() => rooms.id), // Assigned room (null until assigned)

  // Status
  status: reservationStatusEnum('status').notNull().default('pending'),

  // Group linkage (KB 14.3) — nullable; set when a reservation is a member of a
  // group profile. FK is enforced at the DB layer via push-schema ALTER to avoid
  // a circular import (group.ts already references reservations).
  groupProfileId: uuid('group_profile_id'),

  // Rate
  ratePlanId: uuid('rate_plan_id').notNull().references(() => ratePlans.id),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  acceptedPricingSnapshot: jsonb('accepted_pricing_snapshot').$type<AcceptedPricingSnapshot>(),

  // Occupancy
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),

  // Special requests & preferences
  specialRequests: text('special_requests'),
  preferences: jsonb('preferences').$type<Record<string, string>>(),

  // Check-in/out tracking
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
  checkedInBy: uuid('checked_in_by'), // Staff user ID
  checkedOutBy: uuid('checked_out_by'),

  // Cancellation
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),

  // Guest registration (compliance — KB 5.10)
  registrationData: jsonb('registration_data'), // Per-jurisdiction registration form data
  registrationSubmittedAt: timestamp('registration_submitted_at', { withTimezone: true }),

  // Guest ID document (per-stay, encrypted — KB 5.5)
  guestIdDocument: jsonb('guest_id_document'), // { type, encryptedNumber, iv, authTag, country, expiry }

  // Actual arrival/departure timestamps
  actualArrivalTime: timestamp('actual_arrival_time', { withTimezone: true }),
  actualDepartureTime: timestamp('actual_departure_time', { withTimezone: true }),

  // Early check-in / late checkout
  isEarlyCheckin: boolean('is_early_checkin').notNull().default(false),
  isLateCheckout: boolean('is_late_checkout').notNull().default(false),
  earlyCheckinFee: numeric('early_checkin_fee', { precision: 12, scale: 2 }),
  lateCheckoutFee: numeric('late_checkout_fee', { precision: 12, scale: 2 }),

  // Registration card acknowledgment
  registrationSignedAt: timestamp('registration_signed_at', { withTimezone: true }),

  /** When true, room moves are blocked unless explicitly overridden. */
  doNotMove: boolean('do_not_move').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyIdUnique: uniqueIndex('reservations_property_id_unique')
    .on(table.propertyId, table.id),
}));

/**
 * Named occupants on a reservation (one physical room).
 * Reservation = one unit; booking = multi-room wrapper.
 * `reservations.guestId` remains the primary/lead guest for backwards compat
 * and is kept in sync with the row where role = 'primary'.
 */
export const reservationGuestRoleEnum = pgEnum('reservation_guest_role', [
  'primary',
  'accompanying',
]);

export const reservationGuests = pgTable('reservation_guests', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id),
  guestId: uuid('guest_id').notNull().references(() => guests.id),
  role: reservationGuestRoleEnum('role').notNull().default('accompanying'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reservation Notes — free-text operational notes attached to a reservation
 * (front-desk handover, special handling, follow-ups). Property-scoped.
 * `isActive` supports an active-count badge without hard-deleting history.
 */
export const reservationNotes = pgTable('reservation_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id),
  body: text('body').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  authorUserId: uuid('author_user_id'), // Staff user who wrote the note (nullable)

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
