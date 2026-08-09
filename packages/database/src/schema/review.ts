import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { reservations } from './reservation.js';

export const reviewSourceEnum = pgEnum('review_source', [
  'google',
  'tripadvisor',
  'booking_com',
  'expedia',
  'other',
]);

export const reviewResponseStatusEnum = pgEnum('review_response_status', [
  'pending',
  'drafted',
  'approved',
  'posted',
]);

/**
 * Guest Reviews — entered manually or imported.
 * Linked to reservations when guest can be matched.
 */
export const guestReviews = pgTable(
  'guest_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    source: reviewSourceEnum('source').notNull(),
    guestName: varchar('guest_name', { length: 200 }).notNull(),
    rating: integer('rating').notNull(), // 1-5
    reviewText: text('review_text').notNull(),
    stayDate: varchar('stay_date', { length: 10 }), // ISO date, optional
    reservationId: uuid('reservation_id').references(() => reservations.id),

    // External source identity (ingested reviews; manual entry may omit)
    externalId: varchar('external_id', { length: 255 }),
    externalUrl: text('external_url'),
    /** Google Places place_id when pulled from Google */
    providerPlaceId: varchar('provider_place_id', { length: 255 }),
    /** TripAdvisor / partner location id */
    providerLocationId: varchar('provider_location_id', { length: 255 }),
    /** Channex channel_id for OTA-sourced reviews */
    providerChannelId: varchar('provider_channel_id', { length: 255 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),

    // Response
    responseStatus: reviewResponseStatusEnum('response_status').notNull().default('pending'),
    responseText: text('response_text'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    respondedBy: uuid('responded_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceExternalUnique: uniqueIndex('guest_reviews_property_source_external_unique').on(
      t.propertyId,
      t.source,
      t.externalId,
    ),
  }),
);
