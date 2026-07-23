/**
 * HAIP Demo Seed — "Telivity Grand Hotel"
 *
 * Creates a fully-populated demo property with enough data to exercise every
 * dashboard screen.  Idempotent: uses property code 'TGH' as the anchor and
 * skips if it already exists.
 *
 * Run:  pnpm --filter @telivityhaip/database seed
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as schema from './schema/index.js';

/**
 * Fixed publishable booking-engine key for the demo property. The raw value is
 * intentionally well-known (it ships in this public repo) so the one-command demo
 * and CI can drive the booking engine without a generation step. Only its sha256
 * hash is stored. Real deployments generate their own keys in the dashboard.
 */
const DEMO_BOOKING_KEY = 'pk_live_HAIPDEMO0000000000000000';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

const PROPERTY_CODE = 'TGH';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic UUID v5-style: prefix + padded index → valid UUID format */
function sid(prefix: string, n: number): string {
  const hex = prefix.padEnd(8, '0').slice(0, 8);
  const idx = n.toString(16).padStart(4, '0');
  return `${hex}-0000-4000-a000-${idx.padStart(12, '0')}`;
}

function daysFromNow(d: number): Date {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function dateStr(d: number): string {
  return daysFromNow(d).toISOString().slice(0, 10);
}

function ts(d: number, hh = 0, mm = 0): Date {
  const dt = daysFromNow(d);
  dt.setHours(hh, mm, 0, 0);
  return dt;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  // Idempotency check
  const existing = await db
    .select()
    .from(schema.properties)
    .where(eq(schema.properties.code, PROPERTY_CODE))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Property "${PROPERTY_CODE}" already exists — skipping seed.`);
    await client.end();
    return;
  }

  console.log('Seeding Telivity Grand Hotel...');

  // -----------------------------------------------------------------------
  // 1. Property
  // -----------------------------------------------------------------------
  const propertyId = sid('a0000001', 1);

  await db.insert(schema.properties).values({
    id: propertyId,
    name: 'Telivity Grand Hotel',
    code: PROPERTY_CODE,
    description: 'A luxury demo property for the HAIP platform.',
    addressLine1: '100 Ocean Drive',
    city: 'Miami Beach',
    stateProvince: 'FL',
    postalCode: '33139',
    countryCode: 'US',
    timezone: 'America/New_York',
    currencyCode: 'USD',
    defaultLanguage: 'en',
    starRating: 5,
    totalRooms: 40,
    phone: '+1-305-555-0100',
    email: 'info@telivitygrand.demo',
    website: 'https://telivitygrand.demo',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    nightAuditTime: '02:00',
    overbookingPercentage: 5,
    settings: {
      earlyCheckInFee: 50,
      lateCheckoutFee: 75,
      depositPercentage: 20,
      requireInspection: true,
      taxRate: 0.13,
      noShowFeeAmount: 150,
      noShowCutoffHour: 18,
    },
  });

  // -----------------------------------------------------------------------
  // 2. Room Types (4)
  // -----------------------------------------------------------------------
  const roomTypeIds = {
    standard: sid('b0000001', 1),
    deluxe: sid('b0000001', 2),
    suite: sid('b0000001', 3),
    penthouse: sid('b0000001', 4),
  };

  await db.insert(schema.roomTypes).values([
    { id: roomTypeIds.standard, propertyId, name: 'Standard King', code: 'STK', maxOccupancy: 2, defaultOccupancy: 2, bedType: 'king', bedCount: 1, squareMeters: 30, isAccessible: false, amenities: ['wifi', 'tv', 'minibar', 'safe'], sortOrder: 1 },
    { id: roomTypeIds.deluxe, propertyId, name: 'Deluxe Ocean View', code: 'DOV', maxOccupancy: 3, defaultOccupancy: 2, bedType: 'king', bedCount: 1, squareMeters: 42, isAccessible: false, amenities: ['wifi', 'tv', 'minibar', 'safe', 'balcony', 'ocean_view'], sortOrder: 2 },
    { id: roomTypeIds.suite, propertyId, name: 'Junior Suite', code: 'JST', maxOccupancy: 4, defaultOccupancy: 2, bedType: 'king', bedCount: 1, squareMeters: 55, isAccessible: false, amenities: ['wifi', 'tv', 'minibar', 'safe', 'balcony', 'ocean_view', 'living_area', 'espresso_machine'], sortOrder: 3 },
    { id: roomTypeIds.penthouse, propertyId, name: 'Penthouse Suite', code: 'PHS', maxOccupancy: 4, defaultOccupancy: 2, bedType: 'king', bedCount: 1, squareMeters: 95, isAccessible: false, amenities: ['wifi', 'tv', 'minibar', 'safe', 'terrace', 'ocean_view', 'living_area', 'dining_area', 'espresso_machine', 'jacuzzi'], sortOrder: 4 },
  ]);

  // -----------------------------------------------------------------------
  // 2b. Media — stock photos (Unsplash, license-clean) for the property and
  //     each room type. URL-only (storage_key null); uploaded binaries are
  //     never committed. One primary image per owner.
  // -----------------------------------------------------------------------
  const img = (photoId: string) =>
    `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=1600&q=80`;

  await db.insert(schema.media).values([
    // Property gallery
    { id: sid('ed000001', 1), propertyId, ownerType: 'property' as const, ownerId: propertyId, url: img('1566073771259-6a8506099945'), category: 'hero' as const, caption: 'Telivity Grand Hotel — oceanfront facade', isPrimary: true, sortOrder: 0 },
    { id: sid('ed000001', 2), propertyId, ownerType: 'property' as const, ownerId: propertyId, url: img('1551882547-ff40c63fe5fa'), category: 'exterior' as const, caption: 'Pool terrace at golden hour', sortOrder: 1 },
    { id: sid('ed000001', 3), propertyId, ownerType: 'property' as const, ownerId: propertyId, url: img('1414235077428-338989a2e8c0'), category: 'dining' as const, caption: 'The Azure restaurant', sortOrder: 2 },
    // Standard King
    { id: sid('ed000001', 16), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.standard, url: img('1611892440504-42a792e24d32'), category: 'room' as const, caption: 'Standard King', isPrimary: true, sortOrder: 0 },
    { id: sid('ed000001', 17), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.standard, url: img('1631049307264-da0ec9d70304'), category: 'room' as const, caption: 'Standard King — workspace', sortOrder: 1 },
    // Deluxe Ocean View
    { id: sid('ed000001', 32), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.deluxe, url: img('1582719478250-c89cae4dc85b'), category: 'room' as const, caption: 'Deluxe Ocean View', isPrimary: true, sortOrder: 0 },
    { id: sid('ed000001', 33), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.deluxe, url: img('1590490360182-c33d57733427'), category: 'room' as const, caption: 'Deluxe — private balcony', sortOrder: 1 },
    // Junior Suite
    { id: sid('ed000001', 48), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.suite, url: img('1591088398332-8a7791972843'), category: 'room' as const, caption: 'Junior Suite living area', isPrimary: true, sortOrder: 0 },
    { id: sid('ed000001', 49), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.suite, url: img('1618773928121-c32242e63f39'), category: 'room' as const, caption: 'Junior Suite bedroom', sortOrder: 1 },
    // Penthouse Suite
    { id: sid('ed000001', 64), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.penthouse, url: img('1596394516093-501ba68a0ba6'), category: 'room' as const, caption: 'Penthouse Suite', isPrimary: true, sortOrder: 0 },
    { id: sid('ed000001', 65), propertyId, ownerType: 'room_type' as const, ownerId: roomTypeIds.penthouse, url: img('1582719508461-905c673771fd'), category: 'room' as const, caption: 'Penthouse terrace', sortOrder: 1 },
  ]);

  // -----------------------------------------------------------------------
  // 2c. RBAC — system roles, permission grants, demo users (local authz).
  //     Permission keys MIRROR apps/api/src/modules/auth/permissions.catalog.ts
  //     (the API is the source of truth; kept in sync intentionally).
  // -----------------------------------------------------------------------
  const ALL_PERMS = [
    'dashboard.view', 'frontdesk.access', 'reservations.read', 'reservations.write',
    'guests.read', 'guests.write', 'rooms.read', 'rooms.write', 'media.manage',
    'housekeeping.read', 'housekeeping.manage', 'folios.read', 'folios.manage',
    'groups.read', 'groups.manage', 'cashier.access', 'houseaccounts.read', 'houseaccounts.manage',
    'accounting.view', 'tax.manage',
    'rateplans.read', 'rateplans.manage', 'services.read', 'services.manage', 'policies.read', 'policies.manage', 'revenue.manage', 'nightaudit.run',
    'reports.view', 'channels.manage', 'communications.manage', 'reviews.manage',
    'settings.manage', 'bookingengine.manage', 'admin.users.manage', 'admin.roles.manage',
  ];
  const ROLE_DEFS: { key: string; name: string; perms: string[] }[] = [
    { key: 'admin', name: 'Administrator', perms: ALL_PERMS },
    { key: 'front_desk', name: 'Front Desk', perms: ['dashboard.view', 'frontdesk.access', 'reservations.read', 'reservations.write', 'guests.read', 'guests.write', 'rooms.read', 'media.manage', 'folios.read', 'folios.manage', 'groups.read', 'houseaccounts.read', 'houseaccounts.manage', 'rateplans.read', 'services.read', 'services.manage', 'policies.read', 'communications.manage', 'reviews.manage'] },
    { key: 'housekeeping', name: 'Housekeeping', perms: ['dashboard.view', 'rooms.read', 'housekeeping.read'] },
    { key: 'housekeeping_manager', name: 'Housekeeping Manager', perms: ['dashboard.view', 'rooms.read', 'rooms.write', 'housekeeping.read', 'housekeeping.manage'] },
    { key: 'night_auditor', name: 'Night Auditor', perms: ['dashboard.view', 'reservations.read', 'folios.read', 'nightaudit.run', 'reports.view', 'cashier.access', 'houseaccounts.read', 'accounting.view'] },
    { key: 'readonly', name: 'Read Only', perms: ['dashboard.view', 'reservations.read', 'guests.read', 'rooms.read', 'folios.read', 'rateplans.read', 'services.read', 'policies.read', 'reports.view'] },
  ];

  const roleIdByKey: Record<string, string> = {};
  await db.insert(schema.roles).values(
    ROLE_DEFS.map((r, i) => {
      const id = sid('ee000001', i + 1);
      roleIdByKey[r.key] = id;
      // System roles are global (propertyId null) and read-only in the admin UI.
      return { id, propertyId: null, key: r.key, name: r.name, description: `Built-in ${r.name} role`, isSystem: true };
    }),
  );
  await db.insert(schema.rolePermissions).values(
    ROLE_DEFS.flatMap((r) =>
      r.perms.map((permissionKey) => ({ propertyId, roleId: roleIdByKey[r.key]!, permissionKey })),
    ),
  );

  const userDefs: { name: string; email: string; roleKey: string }[] = [
    { name: 'Demo Admin', email: 'admin@telivitygrand.com', roleKey: 'admin' },
    { name: 'Anna Schmidt', email: 'anna@telivitygrand.com', roleKey: 'front_desk' },
    { name: 'Lena Novak', email: 'lena@telivitygrand.com', roleKey: 'housekeeping' },
    { name: 'Marco Rossi', email: 'marco@telivitygrand.com', roleKey: 'housekeeping_manager' },
    { name: 'Nadia Haddad', email: 'nadia@telivitygrand.com', roleKey: 'night_auditor' },
  ];
  const userIds = userDefs.map((_, i) => sid('ef000001', i + 1));
  await db.insert(schema.users).values(
    userDefs.map((u, i) => ({ id: userIds[i]!, propertyId, keycloakSub: null, email: u.email, name: u.name, status: 'active' as const })),
  );
  await db.insert(schema.userRoles).values(
    userDefs.map((u, i) => ({ propertyId, userId: userIds[i]!, roleId: roleIdByKey[u.roleKey]! })),
  );

  // -----------------------------------------------------------------------
  // 3. Rooms (40 across 4 floors, mixed statuses)
  // -----------------------------------------------------------------------
  type RoomStatus = 'vacant_clean' | 'vacant_dirty' | 'clean' | 'inspected' | 'guest_ready' | 'occupied' | 'out_of_order' | 'out_of_service';

  interface RoomDef {
    number: string;
    floor: string;
    typeKey: keyof typeof roomTypeIds;
    status: RoomStatus;
    accessible?: boolean;
  }

  const roomDefs: RoomDef[] = [
    // Floor 1 — 10 rooms (Standard)
    { number: '101', floor: '1', typeKey: 'standard', status: 'occupied' },
    { number: '102', floor: '1', typeKey: 'standard', status: 'occupied' },
    { number: '103', floor: '1', typeKey: 'standard', status: 'vacant_dirty' },
    { number: '104', floor: '1', typeKey: 'standard', status: 'guest_ready' },
    { number: '105', floor: '1', typeKey: 'standard', status: 'guest_ready' },
    { number: '106', floor: '1', typeKey: 'standard', status: 'clean' },
    { number: '107', floor: '1', typeKey: 'standard', status: 'inspected' },
    { number: '108', floor: '1', typeKey: 'standard', status: 'vacant_clean' },
    { number: '109', floor: '1', typeKey: 'standard', status: 'out_of_order', accessible: true },
    { number: '110', floor: '1', typeKey: 'standard', status: 'occupied', accessible: true },
    // Floor 2 — 10 rooms (Deluxe)
    { number: '201', floor: '2', typeKey: 'deluxe', status: 'occupied' },
    { number: '202', floor: '2', typeKey: 'deluxe', status: 'occupied' },
    { number: '203', floor: '2', typeKey: 'deluxe', status: 'vacant_dirty' },
    { number: '204', floor: '2', typeKey: 'deluxe', status: 'guest_ready' },
    { number: '205', floor: '2', typeKey: 'deluxe', status: 'guest_ready' },
    { number: '206', floor: '2', typeKey: 'deluxe', status: 'clean' },
    { number: '207', floor: '2', typeKey: 'deluxe', status: 'inspected' },
    { number: '208', floor: '2', typeKey: 'deluxe', status: 'vacant_clean' },
    { number: '209', floor: '2', typeKey: 'deluxe', status: 'out_of_service' },
    { number: '210', floor: '2', typeKey: 'deluxe', status: 'occupied' },
    // Floor 3 — 10 rooms (Suite)
    { number: '301', floor: '3', typeKey: 'suite', status: 'occupied' },
    { number: '302', floor: '3', typeKey: 'suite', status: 'occupied' },
    { number: '303', floor: '3', typeKey: 'suite', status: 'vacant_dirty' },
    { number: '304', floor: '3', typeKey: 'suite', status: 'guest_ready' },
    { number: '305', floor: '3', typeKey: 'suite', status: 'guest_ready' },
    { number: '306', floor: '3', typeKey: 'suite', status: 'clean' },
    { number: '307', floor: '3', typeKey: 'suite', status: 'inspected' },
    { number: '308', floor: '3', typeKey: 'suite', status: 'vacant_clean' },
    { number: '309', floor: '3', typeKey: 'suite', status: 'occupied' },
    { number: '310', floor: '3', typeKey: 'suite', status: 'occupied' },
    // Floor 4 — 10 rooms (Penthouse + mix)
    { number: '401', floor: '4', typeKey: 'penthouse', status: 'occupied' },
    { number: '402', floor: '4', typeKey: 'penthouse', status: 'guest_ready' },
    { number: '403', floor: '4', typeKey: 'penthouse', status: 'vacant_dirty' },
    { number: '404', floor: '4', typeKey: 'penthouse', status: 'vacant_clean' },
    { number: '405', floor: '4', typeKey: 'suite', status: 'occupied' },
    { number: '406', floor: '4', typeKey: 'suite', status: 'guest_ready' },
    { number: '407', floor: '4', typeKey: 'suite', status: 'clean' },
    { number: '408', floor: '4', typeKey: 'deluxe', status: 'occupied' },
    { number: '409', floor: '4', typeKey: 'deluxe', status: 'guest_ready' },
    { number: '410', floor: '4', typeKey: 'deluxe', status: 'out_of_order' },
  ];

  const roomIdMap: Record<string, string> = {};

  await db.insert(schema.rooms).values(
    roomDefs.map((r, i) => {
      const id = sid('c0000001', i + 1);
      roomIdMap[r.number] = id;
      return {
        id,
        propertyId,
        roomTypeId: roomTypeIds[r.typeKey],
        number: r.number,
        floor: r.floor,
        building: 'Main',
        status: r.status,
        isAccessible: r.accessible ?? false,
        maintenanceNotes: r.status === 'out_of_order' ? 'HVAC repair scheduled' : null,
      };
    }),
  );

  // -----------------------------------------------------------------------
  // 4. Rate Plans (4 base + 1 derived)
  // -----------------------------------------------------------------------
  const policyIds = {
    flexible: sid('d0500001', 1),
    moderate: sid('d0500001', 2),
    nonRefundable: sid('d0500001', 3),
  };

  await db.insert(schema.cancellationPolicies).values([
    {
      id: policyIds.flexible,
      propertyId,
      name: 'Flexible',
      code: 'FLEX-24',
      description: 'Free cancellation up to 24 hours before check-in. First night charge after.',
      freeCancelHoursBeforeArrival: 24,
      penaltyType: 'first_night',
      depositHandling: 'refund_if_refundable',
      isActive: true,
    },
    {
      id: policyIds.moderate,
      propertyId,
      name: 'Moderate',
      code: 'MOD-48',
      description: 'Free cancellation up to 48 hours before check-in. First night charge after.',
      freeCancelHoursBeforeArrival: 48,
      penaltyType: 'first_night',
      depositHandling: 'refund_if_refundable',
      isActive: true,
    },
    {
      id: policyIds.nonRefundable,
      propertyId,
      name: 'Non-refundable',
      code: 'NRFN',
      description: 'Non-refundable — full charge applies on cancel or no-show.',
      freeCancelHoursBeforeArrival: 0,
      penaltyType: 'full',
      depositHandling: 'always_forfeit',
      isActive: true,
    },
  ]);

  const rpIds = {
    stdBar: sid('d0000001', 1),
    dlxBar: sid('d0000001', 2),
    suiteBar: sid('d0000001', 3),
    phBar: sid('d0000001', 4),
    dlxPromo: sid('d0000001', 5),
  };

  await db.insert(schema.ratePlans).values([
    { id: rpIds.stdBar, propertyId, roomTypeId: roomTypeIds.standard, name: 'Standard BAR', code: 'STK-BAR', type: 'bar', baseAmount: '189.00', currencyCode: 'USD', mealPlan: 'room_only', cancellationPolicyId: policyIds.flexible, sortOrder: 1 },
    { id: rpIds.dlxBar, propertyId, roomTypeId: roomTypeIds.deluxe, name: 'Deluxe BAR', code: 'DOV-BAR', type: 'bar', baseAmount: '289.00', currencyCode: 'USD', mealPlan: 'breakfast', cancellationPolicyId: policyIds.flexible, sortOrder: 2 },
    { id: rpIds.suiteBar, propertyId, roomTypeId: roomTypeIds.suite, name: 'Suite BAR', code: 'JST-BAR', type: 'bar', baseAmount: '429.00', currencyCode: 'USD', mealPlan: 'breakfast', cancellationPolicyId: policyIds.moderate, sortOrder: 3 },
    { id: rpIds.phBar, propertyId, roomTypeId: roomTypeIds.penthouse, name: 'Penthouse BAR', code: 'PHS-BAR', type: 'bar', baseAmount: '799.00', currencyCode: 'USD', mealPlan: 'half_board', cancellationPolicyId: policyIds.moderate, sortOrder: 4 },
    { id: rpIds.dlxPromo, propertyId, roomTypeId: roomTypeIds.deluxe, name: 'Deluxe Summer Promo', code: 'DOV-SUM', type: 'promotional', baseAmount: '239.00', currencyCode: 'USD', mealPlan: 'breakfast', validFrom: dateStr(0), validTo: dateStr(90), channelCodes: ['booking_com', 'expedia'], cancellationPolicyId: policyIds.nonRefundable, sortOrder: 5 },
  ]);

  // Rate restrictions — weekend surcharges + min-LOS
  await db.insert(schema.rateRestrictions).values([
    { id: sid('d1000001', 1), propertyId, ratePlanId: rpIds.stdBar, startDate: dateStr(0), endDate: dateStr(90), minLos: 1, maxLos: 14, dayOfWeekOverrides: { friday: 20, saturday: 30 } },
    { id: sid('d1000001', 2), propertyId, ratePlanId: rpIds.dlxBar, startDate: dateStr(0), endDate: dateStr(90), minLos: 2, dayOfWeekOverrides: { friday: 30, saturday: 40 } },
    { id: sid('d1000001', 3), propertyId, ratePlanId: rpIds.suiteBar, startDate: dateStr(0), endDate: dateStr(60), minLos: 2, maxLos: 7 },
  ]);

  // -----------------------------------------------------------------------
  // 4b. Ancillary services (breakfast / parking / late checkout)
  // -----------------------------------------------------------------------
  await db.insert(schema.services).values([
    {
      id: sid('d2000001', 1),
      propertyId,
      code: 'BREAKFAST',
      name: 'Breakfast Buffet',
      description: 'Full breakfast buffet per person per night',
      chargeType: 'food_beverage',
      price: '28.00',
      currencyCode: 'USD',
      postingRule: 'per_night',
      sellChannels: ['booking_engine', 'front_desk', 'pre_arrival'],
      isActive: true,
      sortOrder: 1,
    },
    {
      id: sid('d2000001', 2),
      propertyId,
      code: 'PARKING',
      name: 'Valet Parking',
      description: 'Covered valet parking for the stay',
      chargeType: 'parking',
      price: '45.00',
      currencyCode: 'USD',
      postingRule: 'once',
      sellChannels: ['booking_engine', 'front_desk', 'pre_arrival'],
      isActive: true,
      sortOrder: 2,
    },
    {
      id: sid('d2000001', 3),
      propertyId,
      code: 'LATECO',
      name: 'Late Checkout',
      description: 'Checkout extended until 14:00',
      chargeType: 'fee',
      price: '50.00',
      currencyCode: 'USD',
      postingRule: 'once',
      sellChannels: ['front_desk'],
      isActive: true,
      sortOrder: 3,
    },
  ]);

  // -----------------------------------------------------------------------
  // 5. Guests (15)
  // -----------------------------------------------------------------------
  interface GuestDef {
    first: string; last: string; email: string; phone: string;
    vip: 'none' | 'silver' | 'gold' | 'platinum' | 'diamond';
    company?: string; loyalty?: string; isDnr?: boolean; dnrReason?: string;
  }

  const guestDefs: GuestDef[] = [
    { first: 'James', last: 'Morrison', email: 'james.morrison@example.com', phone: '+1-305-555-0201', vip: 'diamond', company: 'Morrison Capital', loyalty: 'TGH-D001' },
    { first: 'Sofia', last: 'Chen', email: 'sofia.chen@example.com', phone: '+1-305-555-0202', vip: 'platinum', loyalty: 'TGH-P002' },
    { first: 'Marcus', last: 'Williams', email: 'marcus.w@example.com', phone: '+1-305-555-0203', vip: 'gold', company: 'Williams Group' },
    { first: 'Elena', last: 'Petrova', email: 'elena.p@example.com', phone: '+7-495-555-0204', vip: 'gold' },
    { first: 'David', last: 'Park', email: 'david.park@example.com', phone: '+82-2-555-0205', vip: 'silver', company: 'Park Industries' },
    { first: 'Sarah', last: 'Johnson', email: 'sarah.j@example.com', phone: '+1-212-555-0206', vip: 'none' },
    { first: 'Ahmed', last: 'Al-Rashid', email: 'ahmed.ar@example.com', phone: '+971-4-555-0207', vip: 'platinum', company: 'Al-Rashid Holdings' },
    { first: 'Maria', last: 'Garcia', email: 'maria.g@example.com', phone: '+34-91-555-0208', vip: 'none' },
    { first: 'Takeshi', last: 'Yamamoto', email: 'takeshi.y@example.com', phone: '+81-3-555-0209', vip: 'silver' },
    { first: 'Lisa', last: 'Thompson', email: 'lisa.t@example.com', phone: '+1-415-555-0210', vip: 'none' },
    { first: 'Hans', last: 'Mueller', email: 'hans.m@example.com', phone: '+49-30-555-0211', vip: 'gold', company: 'Mueller GmbH' },
    { first: 'Priya', last: 'Patel', email: 'priya.p@example.com', phone: '+91-22-555-0212', vip: 'none' },
    { first: 'Robert', last: 'Brown', email: 'robert.b@example.com', phone: '+1-310-555-0213', vip: 'none', isDnr: true, dnrReason: 'Property damage incident - March 2025' },
    { first: 'Yuki', last: 'Tanaka', email: 'yuki.t@example.com', phone: '+81-6-555-0214', vip: 'silver' },
    { first: 'Carlos', last: 'Rivera', email: 'carlos.r@example.com', phone: '+52-55-555-0215', vip: 'none' },
  ];

  const guestIds = guestDefs.map((_, i) => sid('e0000001', i + 1));

  await db.insert(schema.guests).values(
    guestDefs.map((g, i) => ({
      id: guestIds[i],
      firstName: g.first,
      lastName: g.last,
      email: g.email,
      phone: g.phone,
      vipLevel: g.vip,
      companyName: g.company ?? null,
      loyaltyNumber: g.loyalty ?? null,
      isDnr: g.isDnr ?? false,
      dnrReason: g.dnrReason ?? null,
      dnrDate: g.isDnr ? new Date() : null,
      nationality: 'US',
      gdprConsentMarketing: true,
      gdprConsentDate: new Date(),
    })),
  );

  // -----------------------------------------------------------------------
  // 6. Bookings + Reservations (various states)
  // -----------------------------------------------------------------------
  // Helper to create a booking+reservation pair
  interface ResDef {
    guestIdx: number;
    arrival: number; // days from now
    departure: number;
    roomNum: string;
    typeKey: keyof typeof roomTypeIds;
    rpKey: keyof typeof rpIds;
    status: 'pending' | 'confirmed' | 'assigned' | 'checked_in' | 'stayover' | 'due_out' | 'checked_out' | 'no_show' | 'cancelled';
    source: 'direct' | 'ota' | 'gds' | 'phone' | 'walk_in' | 'agent' | 'group' | 'corporate';
    amount: number;
  }

  const resDefs: ResDef[] = [
    // Past — checked out
    { guestIdx: 0, arrival: -10, departure: -7, roomNum: '401', typeKey: 'penthouse', rpKey: 'phBar', status: 'checked_out', source: 'direct', amount: 2397 },
    { guestIdx: 5, arrival: -5, departure: -2, roomNum: '104', typeKey: 'standard', rpKey: 'stdBar', status: 'checked_out', source: 'ota', amount: 567 },
    { guestIdx: 7, arrival: -3, departure: -1, roomNum: '203', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'checked_out', source: 'phone', amount: 578 },
    // Currently in-house (checked_in)
    { guestIdx: 0, arrival: -2, departure: 3, roomNum: '401', typeKey: 'penthouse', rpKey: 'phBar', status: 'checked_in', source: 'direct', amount: 3995 },
    { guestIdx: 1, arrival: -1, departure: 4, roomNum: '301', typeKey: 'suite', rpKey: 'suiteBar', status: 'checked_in', source: 'direct', amount: 2145 },
    { guestIdx: 2, arrival: -3, departure: 1, roomNum: '201', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'checked_in', source: 'corporate', amount: 1156 },
    { guestIdx: 3, arrival: -1, departure: 2, roomNum: '202', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'checked_in', source: 'ota', amount: 867 },
    { guestIdx: 4, arrival: -2, departure: 1, roomNum: '101', typeKey: 'standard', rpKey: 'stdBar', status: 'checked_in', source: 'gds', amount: 567 },
    { guestIdx: 6, arrival: -1, departure: 3, roomNum: '302', typeKey: 'suite', rpKey: 'suiteBar', status: 'checked_in', source: 'agent', amount: 1716 },
    { guestIdx: 8, arrival: -2, departure: 2, roomNum: '102', typeKey: 'standard', rpKey: 'stdBar', status: 'checked_in', source: 'ota', amount: 756 },
    { guestIdx: 10, arrival: -1, departure: 2, roomNum: '210', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'checked_in', source: 'corporate', amount: 867 },
    { guestIdx: 13, arrival: -3, departure: 0, roomNum: '309', typeKey: 'suite', rpKey: 'suiteBar', status: 'checked_in', source: 'direct', amount: 1287 },
    { guestIdx: 14, arrival: -2, departure: 0, roomNum: '310', typeKey: 'suite', rpKey: 'suiteBar', status: 'checked_in', source: 'walk_in', amount: 858 },
    { guestIdx: 9, arrival: -1, departure: 1, roomNum: '405', typeKey: 'suite', rpKey: 'suiteBar', status: 'checked_in', source: 'phone', amount: 858 },
    { guestIdx: 11, arrival: -2, departure: 3, roomNum: '408', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'checked_in', source: 'ota', amount: 1445 },
    { guestIdx: 7, arrival: -1, departure: 1, roomNum: '110', typeKey: 'standard', rpKey: 'stdBar', status: 'checked_in', source: 'direct', amount: 378 },
    // Today arrivals (confirmed, waiting check-in)
    { guestIdx: 5, arrival: 0, departure: 3, roomNum: '104', typeKey: 'standard', rpKey: 'stdBar', status: 'confirmed', source: 'ota', amount: 567 },
    { guestIdx: 12, arrival: 0, departure: 2, roomNum: '204', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'confirmed', source: 'direct', amount: 578 },
    // Future reservations
    { guestIdx: 0, arrival: 7, departure: 14, roomNum: '401', typeKey: 'penthouse', rpKey: 'phBar', status: 'confirmed', source: 'direct', amount: 5593 },
    { guestIdx: 3, arrival: 5, departure: 8, roomNum: '301', typeKey: 'suite', rpKey: 'suiteBar', status: 'confirmed', source: 'ota', amount: 1287 },
    { guestIdx: 9, arrival: 10, departure: 14, roomNum: '205', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'pending', source: 'phone', amount: 1156 },
    // No-show
    { guestIdx: 14, arrival: -1, departure: 1, roomNum: '108', typeKey: 'standard', rpKey: 'stdBar', status: 'no_show', source: 'ota', amount: 378 },
    // Cancelled
    { guestIdx: 11, arrival: 3, departure: 5, roomNum: '206', typeKey: 'deluxe', rpKey: 'dlxBar', status: 'cancelled', source: 'gds', amount: 578 },
  ];

  for (const [i, r] of resDefs.entries()) {
    const bookingId = sid('f0000001', i + 1);
    const resId = sid('f1000001', i + 1);
    const confNum = `TGH-${(2025000 + i + 1).toString()}`;
    const guestId = guestIds[r.guestIdx]!;

    await db.insert(schema.bookings).values({
      id: bookingId,
      propertyId,
      guestId,
      confirmationNumber: confNum,
      source: r.source,
      channelCode: r.source === 'ota' ? 'booking_com' : null,
    });

    const nights = r.departure - r.arrival;
    const checkedIn = ['checked_in', 'stayover', 'due_out'].includes(r.status);
    const checkedOut = r.status === 'checked_out';

    await db.insert(schema.reservations).values({
      id: resId,
      propertyId,
      bookingId,
      guestId,
      arrivalDate: dateStr(r.arrival),
      departureDate: dateStr(r.departure),
      nights,
      roomTypeId: roomTypeIds[r.typeKey],
      roomId: roomIdMap[r.roomNum] ?? null,
      status: r.status,
      ratePlanId: rpIds[r.rpKey],
      totalAmount: r.amount.toFixed(2),
      currencyCode: 'USD',
      adults: 2,
      children: 0,
      checkedInAt: checkedIn || checkedOut ? ts(r.arrival, 15, 30) : null,
      checkedOutAt: checkedOut ? ts(r.departure, 10, 45) : null,
      cancelledAt: r.status === 'cancelled' ? new Date() : null,
      cancellationReason: r.status === 'cancelled' ? 'Guest requested cancellation' : null,
    });

    // Create folios for checked-in and checked-out reservations
    if (checkedIn || checkedOut) {
      const folioId = sid('f2000001', i + 1);
      const nightsStayed = checkedOut ? nights : Math.max(1, -r.arrival);
      const roomRate = r.amount / nights;
      const totalCharges = roomRate * nightsStayed * 1.13; // +13% tax
      const totalPayments = checkedOut ? totalCharges : roomRate * 1.13; // deposit

      await db.insert(schema.folios).values({
        id: folioId,
        propertyId,
        reservationId: resId,
        bookingId,
        guestId,
        folioNumber: `F-${confNum}`,
        type: 'guest',
        status: checkedOut ? 'closed' : 'open',
        totalCharges: totalCharges.toFixed(2),
        totalPayments: totalPayments.toFixed(2),
        balance: (totalCharges - totalPayments).toFixed(2),
        currencyCode: 'USD',
        settledAt: checkedOut ? ts(r.departure, 10, 50) : null,
        closedAt: checkedOut ? ts(r.departure, 10, 55) : null,
      });

      // Room charges — one per night stayed
      for (let n = 0; n < nightsStayed; n++) {
        const chargeDay = r.arrival + n;
        const taxAmt = roomRate * 0.13;
        await db.insert(schema.charges).values({
          id: sid('f3000001', i * 20 + n + 1),
          propertyId,
          folioId,
          type: 'room',
          description: `Room ${r.roomNum} — Night ${n + 1}`,
          amount: roomRate.toFixed(2),
          currencyCode: 'USD',
          taxAmount: taxAmt.toFixed(2),
          taxRate: '0.1300',
          serviceDate: ts(chargeDay),
          isLocked: checkedOut,
        });
      }

      // Incidental charges for some guests
      if (i % 3 === 0) {
        await db.insert(schema.charges).values({
          id: sid('f3100001', i + 1),
          propertyId,
          folioId,
          type: 'minibar',
          description: 'Minibar consumption',
          amount: '42.00',
          currencyCode: 'USD',
          taxAmount: '5.46',
          taxRate: '0.1300',
          serviceDate: ts(r.arrival + 1),
        });
      }
      if (i % 4 === 0) {
        await db.insert(schema.charges).values({
          id: sid('f3200001', i + 1),
          propertyId,
          folioId,
          type: 'spa',
          description: 'Spa — Deep Tissue Massage',
          amount: '180.00',
          currencyCode: 'USD',
          taxAmount: '23.40',
          taxRate: '0.1300',
          serviceDate: ts(r.arrival),
        });
      }

      // Payments
      await db.insert(schema.payments).values({
        id: sid('f4000001', i + 1),
        propertyId,
        folioId,
        method: i % 2 === 0 ? 'credit_card' : 'cash',
        status: checkedOut ? 'settled' : 'captured',
        amount: totalPayments.toFixed(2),
        currencyCode: 'USD',
        cardLastFour: i % 2 === 0 ? '4242' : null,
        cardBrand: i % 2 === 0 ? 'Visa' : null,
        processedAt: ts(r.arrival, 15, 35),
      });
    }
  }

  // -----------------------------------------------------------------------
  // 7. Housekeeping Tasks
  // -----------------------------------------------------------------------
  const hkStaffId1 = sid('00aaaaaa', 1);
  const hkStaffId2 = sid('00aaaaaa', 2);
  const hkInspector = sid('00aaaaaa', 3);

  const hkTasks: {
    roomNum: string; type: 'checkout' | 'stayover' | 'deep_clean' | 'inspection' | 'turndown' | 'maintenance';
    status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'inspected' | 'skipped';
    assignedTo?: string; priority?: number; daysAgo?: number;
  }[] = [
    // Today's tasks
    { roomNum: '103', type: 'checkout', status: 'pending', priority: 8 },
    { roomNum: '203', type: 'checkout', status: 'assigned', assignedTo: hkStaffId1, priority: 7 },
    { roomNum: '303', type: 'checkout', status: 'in_progress', assignedTo: hkStaffId2, priority: 6 },
    { roomNum: '403', type: 'checkout', status: 'pending', priority: 5 },
    { roomNum: '101', type: 'stayover', status: 'assigned', assignedTo: hkStaffId1, priority: 3 },
    { roomNum: '201', type: 'stayover', status: 'pending', priority: 3 },
    { roomNum: '301', type: 'stayover', status: 'assigned', assignedTo: hkStaffId2, priority: 3 },
    { roomNum: '102', type: 'stayover', status: 'pending', priority: 2 },
    { roomNum: '106', type: 'inspection', status: 'pending', priority: 4 },
    { roomNum: '206', type: 'inspection', status: 'pending', priority: 4 },
    { roomNum: '109', type: 'maintenance', status: 'pending', priority: 10 },
    // Completed tasks (yesterday)
    { roomNum: '104', type: 'checkout', status: 'inspected', assignedTo: hkStaffId1, priority: 5, daysAgo: 1 },
    { roomNum: '105', type: 'checkout', status: 'inspected', assignedTo: hkStaffId2, priority: 5, daysAgo: 1 },
    { roomNum: '204', type: 'checkout', status: 'inspected', assignedTo: hkStaffId1, priority: 5, daysAgo: 1 },
    { roomNum: '205', type: 'checkout', status: 'inspected', assignedTo: hkStaffId2, priority: 5, daysAgo: 1 },
    { roomNum: '304', type: 'checkout', status: 'completed', assignedTo: hkStaffId1, priority: 5, daysAgo: 1 },
    { roomNum: '305', type: 'checkout', status: 'completed', assignedTo: hkStaffId2, priority: 5, daysAgo: 1 },
    { roomNum: '402', type: 'checkout', status: 'inspected', assignedTo: hkStaffId1, priority: 5, daysAgo: 1 },
  ];

  await db.insert(schema.housekeepingTasks).values(
    hkTasks.map((t, i) => {
      const day = t.daysAgo ?? 0;
      const isCompleted = ['completed', 'inspected'].includes(t.status);
      const isAssigned = ['assigned', 'in_progress', 'completed', 'inspected'].includes(t.status);
      const isStarted = ['in_progress', 'completed', 'inspected'].includes(t.status);
      return {
        id: sid('a1000001', i + 1),
        propertyId,
        roomId: roomIdMap[t.roomNum]!,
        type: t.type,
        status: t.status,
        priority: t.priority ?? 0,
        assignedTo: t.assignedTo ?? null,
        assignedAt: isAssigned ? ts(-day, 7, 0) : null,
        startedAt: isStarted ? ts(-day, 7, 30) : null,
        completedAt: isCompleted ? ts(-day, 8, 15) : null,
        inspectedBy: t.status === 'inspected' ? hkInspector : null,
        inspectedAt: t.status === 'inspected' ? ts(-day, 8, 45) : null,
        checklist: [
          { item: 'Strip and remake bed', checked: isCompleted },
          { item: 'Clean bathroom', checked: isCompleted },
          { item: 'Vacuum carpet', checked: isCompleted },
          { item: 'Restock amenities', checked: isCompleted },
          { item: 'Dust surfaces', checked: isStarted },
          { item: 'Empty trash', checked: isStarted },
        ],
        serviceDate: daysFromNow(-day),
        maintenanceRequired: t.type === 'maintenance',
        maintenanceNotes: t.type === 'maintenance' ? 'HVAC unit not cooling — needs technician' : null,
      };
    }),
  );

  // -----------------------------------------------------------------------
  // 8. Night Audit Run (yesterday)
  // -----------------------------------------------------------------------
  await db.insert(schema.auditRuns).values({
    id: sid('a2000001', 1),
    propertyId,
    businessDate: dateStr(-1),
    status: 'completed',
    roomChargesPosted: '4250.00',
    taxChargesPosted: '552.50',
    noShowsProcessed: '1',
    summary: {
      steps: [
        { step: 'Post room charges', count: 16, status: 'completed' },
        { step: 'Post tax charges', count: 16, status: 'completed' },
        { step: 'Process no-shows', count: 1, status: 'completed' },
        { step: 'Advance business date', count: 1, status: 'completed' },
        { step: 'Update stayover status', count: 14, status: 'completed' },
      ],
    },
    startedAt: ts(-1, 2, 0),
    completedAt: ts(-1, 2, 3),
  });

  // -----------------------------------------------------------------------
  // 9. Channel Connection (Booking.com)
  // -----------------------------------------------------------------------
  await db.insert(schema.channelConnections).values({
    id: sid('a3000001', 1),
    propertyId,
    channelCode: 'booking_com',
    channelName: 'Booking.com',
    adapterType: 'booking_com',
    status: 'active',
    syncDirection: 'bidirectional',
    config: { hotelId: 'BDC-12345', apiKey: '***masked***' },
    ratePlanMapping: [
      { ratePlanId: rpIds.stdBar, channelRateCode: 'STK_RACK' },
      { ratePlanId: rpIds.dlxBar, channelRateCode: 'DOV_RACK' },
      { ratePlanId: rpIds.dlxPromo, channelRateCode: 'DOV_PROMO' },
    ],
    roomTypeMapping: [
      { roomTypeId: roomTypeIds.standard, channelRoomCode: 'SGL_KING' },
      { roomTypeId: roomTypeIds.deluxe, channelRoomCode: 'DBL_OCEAN' },
    ],
    lastSyncAt: ts(-1, 3, 15),
    lastSyncStatus: 'success',
  });

  // Second channel — Expedia, using the real `expedia` adapter (EQC AR /
  // Booking Notification / Image API). Left `pending_setup` so the offline,
  // lean `docker compose up` demo doesn't fire real network calls to Expedia.
  await db.insert(schema.channelConnections).values({
    id: sid('a3000001', 2),
    propertyId,
    channelCode: 'expedia',
    channelName: 'Expedia',
    adapterType: 'expedia',
    status: 'pending_setup',
    syncDirection: 'push',
    config: { hotelId: 'EXP-67890' },
    roomTypeMapping: [
      { roomTypeId: roomTypeIds.standard, channelRoomCode: 'EXP_STD' },
      { roomTypeId: roomTypeIds.deluxe, channelRoomCode: 'EXP_DLX' },
      { roomTypeId: roomTypeIds.suite, channelRoomCode: 'EXP_STE' },
      { roomTypeId: roomTypeIds.penthouse, channelRoomCode: 'EXP_PH' },
    ],
    lastSyncAt: null,
  });

  // Third channel — a `mock`-backed demo channel that is ACTIVE with a room-type
  // mapping, so the offline demo's ARI/content pushes hit a working adapter and
  // succeed (with the seeded stock photos in the payload) without any network.
  await db.insert(schema.channelConnections).values({
    id: sid('a3000001', 3),
    propertyId,
    channelCode: 'demo_channel',
    channelName: 'Demo Channel (mock)',
    adapterType: 'mock',
    status: 'active',
    syncDirection: 'push',
    config: {},
    roomTypeMapping: [
      { roomTypeId: roomTypeIds.standard, channelRoomCode: 'DEMO_STD' },
      { roomTypeId: roomTypeIds.deluxe, channelRoomCode: 'DEMO_DLX' },
      { roomTypeId: roomTypeIds.suite, channelRoomCode: 'DEMO_STE' },
      { roomTypeId: roomTypeIds.penthouse, channelRoomCode: 'DEMO_PH' },
    ],
    lastSyncAt: ts(-1, 2, 0),
    lastSyncStatus: 'success',
  });

  // -----------------------------------------------------------------------
  // 10. Agent Webhook Subscription
  // -----------------------------------------------------------------------
  await db.insert(schema.agentWebhookSubscriptions).values({
    id: sid('a4000001', 1),
    propertyId,
    subscriberId: 'otaip-agent-001',
    subscriberName: 'OTAIP Booking Agent',
    callbackUrl: 'https://otaip.demo/webhooks/haip',
    events: ['reservation.created', 'reservation.updated', 'reservation.cancelled', 'room.status_changed', 'folio.settled'],
    secret: 'whsec_demo_secret_key',
    isActive: true,
    failureCount: 0,
  });

  // -----------------------------------------------------------------------
  // 11. Tax Profile — Miami Beach (13% total)
  // -----------------------------------------------------------------------
  const taxProfileId = sid('a5000001', 1);
  const today = dateStr(0);

  await db.insert(schema.taxProfiles).values({
    id: taxProfileId,
    propertyId,
    name: 'Miami Beach Tax Profile',
    jurisdictionCode: 'US-FL-MIAMI-BEACH',
    isActive: true,
    effectiveFrom: '2024-01-01',
  });

  await db.insert(schema.taxRules).values([
    {
      id: sid('a5100001', 1),
      taxProfileId,
      name: 'Florida State Sales Tax',
      code: 'FL_SALES',
      type: 'percentage',
      rate: '6.0000',
      appliesToChargeTypes: ['room'],
      sortOrder: 1,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5100001', 2),
      taxProfileId,
      name: 'Miami-Dade Discretionary Surtax',
      code: 'MIAMI_DADE_SURTAX',
      type: 'percentage',
      rate: '1.0000',
      appliesToChargeTypes: ['room'],
      sortOrder: 2,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5100001', 3),
      taxProfileId,
      name: 'Tourist Development Tax',
      code: 'MIAMI_DADE_TDT',
      type: 'percentage',
      rate: '6.0000',
      appliesToChargeTypes: ['room'],
      exemptions: { guestTypes: ['government'] },
      sortOrder: 3,
      effectiveFrom: '2024-01-01',
    },
  ]);

  // -----------------------------------------------------------------------
  // 12. Tax Profile — Barcelona (IVA 10% + Tourist Tax €3.50/night, max 7 nights)
  // -----------------------------------------------------------------------
  const barcelonaTaxProfileId = sid('a5000001', 2);

  await db.insert(schema.taxProfiles).values({
    id: barcelonaTaxProfileId,
    propertyId,
    name: 'Barcelona Tax Profile',
    jurisdictionCode: 'ES-CT-BARCELONA',
    isActive: true,
    effectiveFrom: '2024-01-01',
  });

  await db.insert(schema.taxRules).values([
    {
      id: sid('a5200001', 1),
      taxProfileId: barcelonaTaxProfileId,
      name: 'IVA (Spanish VAT)',
      code: 'ES_IVA',
      type: 'percentage',
      rate: '10.0000',
      appliesToChargeTypes: ['room'],
      sortOrder: 1,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5200001', 2),
      taxProfileId: barcelonaTaxProfileId,
      name: 'Tourist Tax (Barcelona)',
      code: 'BCN_TOURIST',
      type: 'flat_per_night',
      rate: '3.5000',
      appliesToChargeTypes: ['room'],
      exemptions: { maxNights: 7 },
      sortOrder: 2,
      effectiveFrom: '2024-01-01',
    },
  ]);

  // -----------------------------------------------------------------------
  // 13. Tax Profile — Amsterdam (BTW 9% + Tourist Tax 7%)
  // -----------------------------------------------------------------------
  const amsterdamTaxProfileId = sid('a5000001', 3);

  await db.insert(schema.taxProfiles).values({
    id: amsterdamTaxProfileId,
    propertyId,
    name: 'Amsterdam Tax Profile',
    jurisdictionCode: 'NL-NH-AMSTERDAM',
    isActive: false, // inactive — only one profile active per property
    effectiveFrom: '2024-01-01',
  });

  await db.insert(schema.taxRules).values([
    {
      id: sid('a5300001', 1),
      taxProfileId: amsterdamTaxProfileId,
      name: 'BTW (Dutch VAT)',
      code: 'NL_BTW',
      type: 'percentage',
      rate: '9.0000',
      appliesToChargeTypes: ['room'],
      sortOrder: 1,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5300001', 2),
      taxProfileId: amsterdamTaxProfileId,
      name: 'Tourist Tax (Amsterdam)',
      code: 'AMS_TOURIST',
      type: 'percentage',
      rate: '7.0000',
      appliesToChargeTypes: ['room'],
      sortOrder: 2,
      effectiveFrom: '2024-01-01',
    },
  ]);

  // -----------------------------------------------------------------------
  // 14. Tax Profile — Germany Berlin (split-component breakfast VAT)
  //     German hotels split a single breakfast charge across two VAT rates:
  //     7% on the food portion (70%) and 19% on the beverage portion (30%).
  // -----------------------------------------------------------------------
  const berlinTaxProfileId = sid('a5000001', 4);

  await db.insert(schema.taxProfiles).values({
    id: berlinTaxProfileId,
    propertyId,
    name: 'Germany Berlin Tax Profile',
    jurisdictionCode: 'DE-BE-BERLIN',
    isActive: false, // inactive — only one profile active per property
    effectiveFrom: '2024-01-01',
  });

  await db.insert(schema.taxRules).values([
    {
      id: sid('a5400001', 1),
      taxProfileId: berlinTaxProfileId,
      name: 'Accommodation VAT',
      code: 'DE_ACCOM_VAT',
      type: 'percentage',
      rate: '7.00',
      appliesToChargeTypes: ['room', 'room_upgrade'],
      sortOrder: 1,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5400001', 2),
      taxProfileId: berlinTaxProfileId,
      name: 'City Tax (Übernachtungsteuer)',
      code: 'DE_CITY_TAX',
      type: 'percentage',
      rate: '5.00',
      appliesToChargeTypes: ['room'],
      exemptions: { guestTypes: ['business'] },
      sortOrder: 2,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5400001', 3),
      taxProfileId: berlinTaxProfileId,
      name: 'Food VAT',
      code: 'DE_FOOD_VAT',
      type: 'split_component',
      rate: '7.00',
      splitPercentage: '70.00',
      appliesToChargeTypes: ['breakfast', 'meal', 'half_board', 'full_board'],
      sortOrder: 1,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5400001', 4),
      taxProfileId: berlinTaxProfileId,
      name: 'Beverage VAT',
      code: 'DE_BEVERAGE_VAT',
      type: 'split_component',
      rate: '19.00',
      splitPercentage: '30.00',
      appliesToChargeTypes: ['breakfast', 'meal', 'half_board', 'full_board'],
      sortOrder: 2,
      effectiveFrom: '2024-01-01',
    },
    {
      id: sid('a5400001', 5),
      taxProfileId: berlinTaxProfileId,
      name: 'Standard VAT',
      code: 'DE_STD_VAT',
      type: 'percentage',
      rate: '19.00',
      appliesToChargeTypes: ['minibar', 'spa', 'parking', 'telephone', 'laundry'],
      sortOrder: 1,
      effectiveFrom: '2024-01-01',
    },
  ]);

  // -----------------------------------------------------------------------
  // 12. AI layer — agent configs, decisions, and reviews
  //     Makes the "AI agents as first-class citizens" story visible on a fresh
  //     demo: agents enabled in suggest mode, a populated decision log (incl. the
  //     Revenue Manager orchestrator), and reviews with drafted responses.
  // -----------------------------------------------------------------------
  const enabledAgents = [
    'revenue_manager', 'pricing', 'demand_forecast', 'overbooking',
    'channel_mix', 'group_pickup', 'review_response', 'guest_comms',
    'cancellation', 'ar_collections', 'night_audit', 'housekeeping',
  ] as const;

  const agentConfigPresets: Record<string, Record<string, unknown>> = {
    revenue_manager: { objective: 'goppar', variableCostPerRoom: 25, fcpar: 60, baselineAdr: null, horizonDays: 30 },
    pricing: { maxAdjustmentPct: 30, revparTarget: 120, weekendPremiumPct: 15, pricingHorizonDays: 30 },
    overbooking: { maxOverbookingPct: 5 },
  };

  await db.insert(schema.agentConfigs).values(
    enabledAgents.map((agentType, i) => ({
      id: sid('a6000001', i + 1),
      propertyId,
      agentType: agentType as any,
      isEnabled: true,
      mode: 'suggest' as const,
      config: agentConfigPresets[agentType] ?? {},
      lastRunAt: ts(0, 6, 0),
    })),
  );

  // A realistic decision log spanning agents, statuses, and recent timestamps.
  await db.insert(schema.agentDecisions).values([
    {
      id: sid('a6100001', 1),
      propertyId,
      agentType: 'revenue_manager' as any,
      decisionType: 'revenue_strategy',
      confidence: '0.88',
      status: 'pending' as const,
      createdAt: ts(0, 6, 5),
      inputSnapshot: { objective: 'goppar', horizonDays: 30, baselineAdr: 289, forecastDays: 30 },
      recommendation: {
        objective: 'goppar',
        horizonDays: 30,
        summary: {
          avgOccupancy: 0.78, peakDates: [dateStr(3), dateStr(4)], lowDates: [dateStr(16)],
          raiseDates: 11, holdDates: 14, lowerDates: 5, minLosDates: 2,
          projectedRevPAR: 231.4, projectedGOPPAR: 96.2,
          guardrails: ['optimize_goppar_not_revenue_alone', 'discounting_is_last_resort', 'rate_grid_integrity_enforced'],
        },
        perDate: [
          { date: dateStr(3), demandLevel: 'peak', priceDirection: 'raise', priceAdjustmentPct: 18, losControl: 'min_los', overbooking: 'zero' },
          { date: dateStr(4), demandLevel: 'peak', priceDirection: 'raise', priceAdjustmentPct: 22, losControl: 'min_los', overbooking: 'zero' },
          { date: dateStr(16), demandLevel: 'low', priceDirection: 'lower', priceAdjustmentPct: -10, losControl: 'none', overbooking: 'aggressive' },
        ],
      },
    },
    {
      id: sid('a6100001', 2),
      propertyId,
      agentType: 'demand_forecast' as any,
      decisionType: 'demand_forecast',
      confidence: '0.81',
      status: 'auto_executed' as const,
      executedAt: ts(0, 6, 2),
      createdAt: ts(0, 6, 1),
      inputSnapshot: { historyDays: 365, totalRooms: 40, modelType: 'heuristic' },
      recommendation: { forecastHorizon: 90, modelType: 'heuristic', summary: { avgOccupancy: 0.78, peakDates: [dateStr(3), dateStr(4)], lowDates: [dateStr(16)] } },
    },
    {
      id: sid('a6100001', 3),
      propertyId,
      agentType: 'pricing' as any,
      decisionType: 'rate_adjustment',
      confidence: '0.83',
      status: 'approved' as const,
      executedAt: ts(-1, 9, 30),
      createdAt: ts(-1, 9, 0),
      inputSnapshot: { ratePlanCount: 5, forecastDays: 30 },
      recommendation: {
        summary: { totalAdjustments: 16, avgAdjustmentPct: 12.4, estimatedRevenueImpact: 4820 },
        adjustments: [
          { ratePlanId: sid('a3000001', 2), date: dateStr(3), currentRate: 289, recommendedRate: 341, adjustmentPct: 18, reason: 'demand_surge, weekend_premium' },
          { ratePlanId: sid('a3000001', 2), date: dateStr(4), currentRate: 289, recommendedRate: 353, adjustmentPct: 22, reason: 'demand_surge' },
        ],
      },
    },
    {
      id: sid('a6100001', 4),
      propertyId,
      agentType: 'overbooking' as any,
      decisionType: 'overbooking_level',
      confidence: '0.79',
      status: 'pending' as const,
      createdAt: ts(0, 6, 3),
      inputSnapshot: { horizonDays: 14 },
      recommendation: { date: dateStr(7), recommendedOverbooking: 2, expectedNoShows: 2.4, walkRisk: 'low' },
    },
    {
      id: sid('a6100001', 5),
      propertyId,
      agentType: 'channel_mix' as any,
      decisionType: 'channel_allocation',
      confidence: '0.76',
      status: 'approved' as const,
      executedAt: ts(-2, 11, 0),
      createdAt: ts(-2, 10, 30),
      inputSnapshot: { channelsAnalyzed: 2 },
      recommendation: { recommendations: [{ channel: 'Booking.com', action: 'shift_allocation', detail: 'net RevPAR higher on direct; trim OTA allotment 10%' }] },
    },
    {
      id: sid('a6100001', 6),
      propertyId,
      agentType: 'group_pickup' as any,
      decisionType: 'group_pickup_forecast',
      confidence: '0.74',
      status: 'pending' as const,
      createdAt: ts(0, 6, 4),
      inputSnapshot: { blocksAnalyzed: 1 },
      recommendation: { block: 'Alumni Reunion', cutoffDate: dateStr(10), projectedPickup: 0.72, recommendation: 'partial_release', suggestedReleaseQty: 8 },
    },
    {
      id: sid('a6100001', 7),
      propertyId,
      agentType: 'cancellation' as any,
      decisionType: 'cancellation_risk',
      confidence: '0.69',
      status: 'pending' as const,
      createdAt: ts(0, 7, 0),
      inputSnapshot: { reservationsScored: 23 },
      recommendation: { highRisk: 3, summary: 'OTA + no-deposit arrivals flagged for the coming weekend' },
    },
    {
      id: sid('a6100001', 8),
      propertyId,
      agentType: 'ar_collections' as any,
      decisionType: 'collection_priority',
      confidence: '0.85',
      status: 'pending' as const,
      createdAt: ts(-1, 8, 0),
      inputSnapshot: { ledgersAnalyzed: 4 },
      recommendation: { highPriority: 1, action: 'send_final_notice', summary: 'one direct-bill ledger > 30 days overdue' },
    },
    {
      id: sid('a6100001', 9),
      propertyId,
      agentType: 'review_response' as any,
      decisionType: 'review_response_draft',
      confidence: '0.9',
      status: 'approved' as const,
      executedAt: ts(-3, 13, 0),
      createdAt: ts(-3, 12, 30),
      inputSnapshot: { reviewId: sid('a6200001', 1), rating: 5 },
      recommendation: { sentiment: 'positive', topics: ['staff', 'cleanliness'], style: 'friendly' },
    },
    {
      id: sid('a6100001', 10),
      propertyId,
      agentType: 'night_audit' as any,
      decisionType: 'anomaly_scan',
      confidence: '0.82',
      status: 'auto_executed' as const,
      executedAt: ts(-1, 3, 0),
      createdAt: ts(-1, 3, 0),
      inputSnapshot: { foliosScanned: 16, shiftsScanned: 1 },
      recommendation: { anomalies: 1, topAnomaly: { type: 'unposted_charge', severity: 'warning' } },
    },
  ]);

  // Guest reviews — some already responded to (AI-drafted), some awaiting action.
  await db.insert(schema.guestReviews).values([
    {
      id: sid('a6200001', 1),
      propertyId,
      source: 'google' as any,
      guestName: 'Michael Chen',
      rating: 5,
      reviewText: 'Outstanding stay. The ocean-view room was spotless and the front-desk team upgraded us at check-in. Will be back.',
      stayDate: dateStr(-12),
      responseStatus: 'posted' as const,
      responseText: 'Thank you so much, Michael! We are delighted the ocean-view room and our team made your stay memorable — we look forward to welcoming you back to Telivity Grand.',
      respondedAt: ts(-10, 10, 0),
    },
    {
      id: sid('a6200001', 2),
      propertyId,
      source: 'tripadvisor' as any,
      guestName: 'Sofia Alvarez',
      rating: 4,
      reviewText: 'Great location and lovely pool. Check-in was a little slow on a busy evening, but the staff were friendly throughout.',
      stayDate: dateStr(-9),
      responseStatus: 'drafted' as const,
      responseText: 'Thank you for the kind words, Sofia! We are glad you enjoyed the pool and location, and we are reviewing our evening check-in staffing to make arrivals quicker. We hope to see you again.',
    },
    {
      id: sid('a6200001', 3),
      propertyId,
      source: 'booking_com' as any,
      guestName: 'Tom Whitfield',
      rating: 3,
      reviewText: 'Comfortable bed and good breakfast, but the room AC was noisy at night. Decent value overall.',
      stayDate: dateStr(-7),
      responseStatus: 'pending' as const,
    },
    {
      id: sid('a6200001', 4),
      propertyId,
      source: 'expedia' as any,
      guestName: 'Yuki Tanaka',
      rating: 5,
      reviewText: 'Impeccable service and a beautiful suite. The concierge arranged everything perfectly.',
      stayDate: dateStr(-5),
      responseStatus: 'pending' as const,
    },
    {
      id: sid('a6200001', 5),
      propertyId,
      source: 'google' as any,
      guestName: 'Greta Hoffmann',
      rating: 2,
      reviewText: 'Nice property but we were charged for a minibar item we did not use. It was corrected at checkout but took a while.',
      stayDate: dateStr(-3),
      responseStatus: 'pending' as const,
    },
  ]);

  // -----------------------------------------------------------------------
  // Done
  // -----------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Booking Engine — enable direct booking + a demo publishable key
  // ---------------------------------------------------------------------------
  await db.insert(schema.bookingEngineConfig).values({
    propertyId,
    isEnabled: true,
    displayName: 'Telivity Grand Hotel',
    primaryColor: '#0F172A',
    accentColor: '#2563EB',
    sellableRoomTypeIds: Object.values(roomTypeIds),
    sellableRatePlanIds: [rpIds.stdBar, rpIds.dlxBar, rpIds.suiteBar, rpIds.phBar, rpIds.dlxPromo],
    depositPolicy: { type: 'first_night', refundable: true },
    autoConfirm: true,
  });
  await db.insert(schema.bookingEngineCredentials).values({
    propertyId,
    label: 'Demo website widget',
    keyHash: createHash('sha256').update(DEMO_BOOKING_KEY).digest('hex'),
    keyPrefix: DEMO_BOOKING_KEY.slice(0, 12),
  });

  // ---------------------------------------------------------------------------
  // A/R ledgers + cash drawers (KB 11 / 12) — demo desk polish
  // ---------------------------------------------------------------------------
  await db.insert(schema.arLedgers).values([
    {
      id: sid('af000001', 1),
      propertyId,
      name: 'Acme Corp',
      description: 'Corporate direct bill — NET30',
      paymentTermsDays: 'NET30',
      status: 'open',
      balance: '0.00',
      currencyCode: 'USD',
    },
    {
      id: sid('af000001', 2),
      propertyId,
      name: 'City Convention Bureau',
      description: 'Group / city account',
      paymentTermsDays: 'NET60',
      status: 'open',
      balance: '0.00',
      currencyCode: 'USD',
    },
  ]);
  await db.insert(schema.cashDrawers).values([
    {
      id: sid('b8000001', 1),
      propertyId,
      name: 'Front Desk 1',
      startingFloat: '200.00',
      isActive: true,
    },
    {
      id: sid('b8000001', 2),
      propertyId,
      name: 'Front Desk 2',
      startingFloat: '150.00',
      isActive: true,
    },
  ]);

  console.log('Seed complete.');
  console.log('  Property:      Telivity Grand Hotel (TGH)');
  console.log('  Room Types:    4');
  console.log('  Media:         12 stock photos (property + room types)');
  console.log('  RBAC:          6 system roles, 5 demo users');
  console.log('  Rooms:         40 across 4 floors');
  console.log('  Guests:        15');
  console.log('  Reservations:  23 (past, in-house, arrivals, future, no-show, cancelled)');
  console.log('  Folios:        16 with charges & payments');
  console.log('  Rate Plans:    5 with restrictions');
  console.log('  Cancel policies: 3 (FLEX-24, MOD-48, NRFN)');
  console.log('  Services:      3 (BREAKFAST, PARKING, LATECO)');
  console.log('  A/R Ledgers:   2 (Acme Corp, City Convention Bureau)');
  console.log('  Cash Drawers:  2 (Front Desk 1/2)');
  console.log('  HK Tasks:      18 (mix of statuses)');
  console.log('  Night Audit:   1 completed run');
  console.log('  Channels:      2 connections');
  console.log('  Webhooks:      1 subscription');
  console.log('  Tax Profiles:  4 (Miami Beach 13%, Barcelona IVA+tourist, Amsterdam BTW+tourist, Berlin split-component)');
  console.log('  AI Agents:     12 enabled (suggest mode, incl. Revenue Manager orchestrator)');
  console.log('  Agent Log:     10 decisions (RManager strategy, pricing, forecast, overbooking, ...)');
  console.log('  Reviews:       5 (2 with AI-drafted responses)');
  console.log('  Booking Engine: enabled — demo key ' + DEMO_BOOKING_KEY);

  await client.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
