import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { organizations } from './organization.js';

/**
 * Property — top-level business unit (hotel, hostel, apartment complex).
 * Multi-property from day one. Every other table references property_id.
 */
export const properties = pgTable('properties', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 20 }).notNull().unique(), // Short property code (e.g., "HTLNYC01")
  description: text('description'),

  // Location
  addressLine1: varchar('address_line_1', { length: 255 }),
  addressLine2: varchar('address_line_2', { length: 255 }),
  city: varchar('city', { length: 100 }),
  stateProvince: varchar('state_province', { length: 100 }),
  postalCode: varchar('postal_code', { length: 20 }),
  countryCode: varchar('country_code', { length: 2 }).notNull(), // ISO 3166-1 alpha-2

  // Property details
  timezone: varchar('timezone', { length: 50 }).notNull(), // IANA timezone (e.g., "America/New_York")
  currencyCode: varchar('currency_code', { length: 3 }).notNull(), // ISO 4217
  defaultLanguage: varchar('default_language', { length: 5 }).notNull().default('en'), // BCP 47
  starRating: integer('star_rating'), // 1-5, nullable for unrated
  totalRooms: integer('total_rooms').notNull(),

  // Contact
  phone: varchar('phone', { length: 30 }),
  email: varchar('email', { length: 255 }),
  website: varchar('website', { length: 500 }),

  // Compliance & tax
  taxJurisdiction: varchar('tax_jurisdiction', { length: 100 }), // For tourist/occupancy tax calculation
  guestRegistrationRequired: boolean('guest_registration_required').notNull().default(true),
  guestRegistrationConfig: jsonb('guest_registration_config'), // Per-jurisdiction form config

  // GDS distribution (designed in Phase 0 per research findings)
  gdsChainCode: varchar('gds_chain_code', { length: 4 }), // GDS chain code
  gdsPropertyId: varchar('gds_property_id', { length: 20 }), // GDS property identifier

  // Operational config
  checkInTime: varchar('check_in_time', { length: 5 }).notNull().default('15:00'), // HH:MM
  checkOutTime: varchar('check_out_time', { length: 5 }).notNull().default('11:00'),
  overbookingPercentage: integer('overbooking_percentage').notNull().default(0), // 0-15% typical
  nightAuditTime: varchar('night_audit_time', { length: 5 }).notNull().default('02:00'),

  // Staff dashboard white-label (separate from guest booking_engine_config branding)
  staffDisplayName: varchar('staff_display_name', { length: 200 }),
  staffLogoMediaId: uuid('staff_logo_media_id'),
  staffPrimaryColor: varchar('staff_primary_color', { length: 9 }),
  staffAccentColor: varchar('staff_accent_color', { length: 9 }),

  // Property settings (flexible JSONB for operational config)
  settings: jsonb('settings').$type<{
    earlyCheckInFee?: number;
    lateCheckoutFee?: number;
    earlyCheckInMinHours?: number;
    lateCheckoutMaxHours?: number;
    depositPercentage?: number;
    depositAuthRequired?: boolean;
    requireInspection?: boolean;
    taxRate?: number;
    noShowFeeAmount?: number;
    noShowCutoffHour?: number;
    auditAutoLock?: boolean;
    fiscal?: {
      providerKey?: string | null;
      config?: Record<string, unknown>;
      documentType?: string | null;
    };
    guestRegistration?: {
      providerKey?: string | null;
      config?: Record<string, unknown>;
    };
    kpiThresholds?: {
      occupancyRate?: { warnBelow?: number; goodAbove?: number };
      adr?: { warnBelow?: number };
      revpar?: { warnBelow?: number };
      totalRevenue?: { warnBelow?: number };
    };
  }>(),

  // Status
  isActive: boolean('is_active').notNull().default(true),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
