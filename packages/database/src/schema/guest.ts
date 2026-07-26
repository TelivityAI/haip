import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

/**
 * Guest VIP levels — used for room assignment priority and service levels.
 */
export const vipLevelEnum = pgEnum('vip_level', ['none', 'silver', 'gold', 'platinum', 'diamond']);

/**
 * Guest Profiles — contact info, preferences, stay history (KB 5.7).
 * GDPR compliant: encrypted fields, consent tracking, deletion support.
 * Guests are NOT property-scoped — a guest can stay at multiple properties.
 */
export const guests = pgTable('guests', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 30 }),

  // ID (for guest registration compliance — KB 5.10)
  idType: varchar('id_type', { length: 30 }), // "passport", "national_id", "drivers_license"
  idNumber: varchar('id_number', { length: 50 }), // Encrypted at application layer
  idCountry: varchar('id_country', { length: 2 }), // ISO 3166-1 alpha-2
  idExpiry: timestamp('id_expiry', { withTimezone: true }),
  nationality: varchar('nationality', { length: 2 }), // ISO 3166-1 alpha-2
  dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
  gender: varchar('gender', { length: 20 }), // "male", "female", "other"
  profession: varchar('profession', { length: 100 }), // Occupation
  taxId: varchar('tax_id', { length: 50 }), // Generic national tax/identity ID (CPF, SSN, NIF, etc.)

  // Regional/jurisdiction registration extensions (FNRH, etc.)
  registrationData: jsonb('registration_data').$type<Record<string, unknown>>(),

  // Address
  addressLine1: varchar('address_line_1', { length: 255 }),
  addressLine2: varchar('address_line_2', { length: 255 }),
  city: varchar('city', { length: 100 }),
  stateProvince: varchar('state_province', { length: 100 }),
  postalCode: varchar('postal_code', { length: 20 }),
  countryCode: varchar('country_code', { length: 2 }),

  // Profile
  vipLevel: vipLevelEnum('vip_level').notNull().default('none'),
  companyName: varchar('company_name', { length: 255 }),
  loyaltyNumber: varchar('loyalty_number', { length: 50 }),

  // Preferences (KB 5.7: bed type, floor, view, smoking, pillow, dietary)
  preferences: jsonb('preferences').$type<Record<string, string>>(),

  // Do Not Rent flag (KB 5.7: non-payment, damage, threats, policy violations)
  isDnr: boolean('is_dnr').notNull().default(false),
  dnrReason: text('dnr_reason'),
  dnrDate: timestamp('dnr_date', { withTimezone: true }),

  // GDPR compliance (KB 5.10)
  gdprConsentMarketing: boolean('gdpr_consent_marketing').notNull().default(false),
  gdprConsentDate: timestamp('gdpr_consent_date', { withTimezone: true }),
  gdprDataRetentionOverride: timestamp('gdpr_data_retention_override', { withTimezone: true }),

  // Notes
  notes: text('notes'),

  // GDPR right-to-erasure (Bug 4): hard DELETE violates FK constraints from
  // bookings and reservations. Erasure anonymizes PII and flips `isDeleted`.
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
