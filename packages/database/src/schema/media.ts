import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { properties } from './property.js';

/**
 * Media — images for properties, room types, and individual rooms.
 *
 * Polymorphic by design: one table serves three owner kinds (property |
 * room_type | room) via (ownerType, ownerId). There is intentionally NO
 * foreign key on ownerId (it can't reference three tables at once); the
 * service validates the owner exists at `propertyId` before insert.
 *
 * Multi-tenancy: `propertyId` is ALWAYS denormalized onto the row — even when
 * the owner is a room/room-type — so every read/update/delete can be scoped by
 * property without a join.
 *
 * URL vs upload: `url` is always populated. For externally-hosted images
 * (e.g. seeded stock photos) `storageKey` is null. For images uploaded through
 * the object-storage pipeline, `storageKey` points at the stored object and
 * `url` is the resolved public URL.
 */
export const mediaOwnerTypeEnum = pgEnum('media_owner_type', [
  'property',
  'room_type',
  'room',
]);

export const mediaCategoryEnum = pgEnum('media_category', [
  'hero',
  'exterior',
  'room',
  'amenity',
  'dining',
  'other',
]);

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),

    // Polymorphic owner (no FK — validated in service)
    ownerType: mediaOwnerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),

    // The image itself
    url: text('url').notNull(), // external URL, or resolved public URL for uploads
    storageKey: varchar('storage_key', { length: 512 }), // null unless uploaded to object storage

    category: mediaCategoryEnum('category').notNull().default('other'),
    caption: varchar('caption', { length: 500 }),
    altText: varchar('alt_text', { length: 500 }),

    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),

    // Optional probed metadata
    width: integer('width'),
    height: integer('height'),
    contentType: varchar('content_type', { length: 100 }),
    fileSize: integer('file_size'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index('media_owner_idx').on(t.ownerType, t.ownerId),
    propertyIdx: index('media_property_idx').on(t.propertyId),
    // At most one primary image per owner.
    onePrimaryPerOwner: uniqueIndex('media_one_primary_per_owner')
      .on(t.ownerType, t.ownerId)
      .where(sql`is_primary = true`),
  }),
);
