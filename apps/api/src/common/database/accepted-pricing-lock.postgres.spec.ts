import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { withAcceptedPricingLock } from './accepted-pricing-lock';
import { AncillaryService } from '../../modules/ancillary/ancillary.service';
import { FolioService } from '../../modules/folio/folio.service';
import { BookingRequestService } from '../../modules/booking-request/booking-request.service';
import { BookingEngineService } from '../../modules/booking-engine/booking-engine.service';
import { BookingEngineConfigService } from '../../modules/booking-engine/booking-engine-config.service';
import { AvailabilityService } from '../../modules/reservation/availability.service';
import { RatePlanService } from '../../modules/rate-plan/rate-plan.service';
import { TaxService } from '../../modules/tax/tax.service';
import { ReservationService } from '../../modules/reservation/reservation.service';
import { NightAuditService } from '../../modules/night-audit/night-audit.service';
import { PolicyService } from '../../modules/policy/policy.service';

const live = process.env['ACCEPTED_PRICING_LIVE_PG'] === '1';
const databaseUrl = process.env['DATABASE_URL'];
const suite = live && databaseUrl ? describe : describe.skip;

suite('accepted-pricing mutex against PostgreSQL', () => {
  const propertyId = 'property-race';
  const reservationId = 'reservation-race';
  const client = postgres(databaseUrl!, { max: 8 });
  const db = drizzle(client);
  const actualIds = {
    property: '12000000-0000-4000-a000-000000000001',
    guest: '12000000-0000-4000-a000-000000000002',
    roomType: '12000000-0000-4000-a000-000000000003',
    room: '12000000-0000-4000-a000-000000000014',
    ratePlan: '12000000-0000-4000-a000-000000000004',
    booking: '12000000-0000-4000-a000-000000000005',
    reservation: '12000000-0000-4000-a000-000000000006',
    folio: '12000000-0000-4000-a000-000000000007',
    service: '12000000-0000-4000-a000-000000000008',
    reservationService: '12000000-0000-4000-a000-000000000009',
    secondProperty: '12000000-0000-4000-a000-000000000010',
    secondFolio: '12000000-0000-4000-a000-000000000011',
    baseCharge: '12000000-0000-4000-a000-000000000012',
    correctionCharge: '12000000-0000-4000-a000-000000000013',
    bookingRequest: '12000000-0000-4000-a000-000000000015',
  };

  beforeAll(async () => {
    await client.unsafe('DROP SCHEMA IF EXISTS task12_accepted_pricing_lock_test CASCADE');
    await client.unsafe('CREATE SCHEMA task12_accepted_pricing_lock_test');
    await client.unsafe(`
      CREATE TABLE task12_accepted_pricing_lock_test.pricing_state (
        property_id text NOT NULL,
        reservation_id text NOT NULL,
        amount numeric(12,2) NOT NULL,
        PRIMARY KEY (property_id, reservation_id)
      )
    `);
    await client.unsafe(`
      CREATE TABLE task12_accepted_pricing_lock_test.ledger (
        source_key text PRIMARY KEY,
        amount numeric(12,2) NOT NULL,
        kind text NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await cleanupActualServiceFixture();
    await client.unsafe('DROP SCHEMA IF EXISTS task12_accepted_pricing_lock_test CASCADE');
    await client.end();
  });

  async function cleanupActualServiceFixture() {
    await client.unsafe('DROP TRIGGER IF EXISTS task12_delay_cancel ON reservation_services');
    await client.unsafe('DROP FUNCTION IF EXISTS task12_delay_cancel()');
    await client.unsafe('DROP TRIGGER IF EXISTS task12_delay_charge ON charges');
    await client.unsafe('DROP FUNCTION IF EXISTS task12_delay_charge()');
    await client.unsafe('DROP TRIGGER IF EXISTS task12_delay_amendment ON reservations');
    await client.unsafe('DROP FUNCTION IF EXISTS task12_delay_amendment()');
    await client`
      DELETE FROM charges
      WHERE property_id IN (${actualIds.property}, ${actualIds.secondProperty})
    `;
    await client`
      DELETE FROM booking_request_consequences WHERE property_id = ${actualIds.property}
    `;
    await client`
      DELETE FROM booking_request_stay_amendments WHERE property_id = ${actualIds.property}
    `;
    await client`DELETE FROM audit_logs WHERE property_id = ${actualIds.property}`;
    await client`DELETE FROM booking_requests WHERE id = ${actualIds.bookingRequest}`;
    await client`DELETE FROM reservation_services WHERE id = ${actualIds.reservationService}`;
    await client`DELETE FROM services WHERE id = ${actualIds.service}`;
    await client`DELETE FROM booking_engine_config WHERE property_id = ${actualIds.property}`;
    await client`DELETE FROM folios WHERE id = ${actualIds.secondFolio}`;
    await client`DELETE FROM folios WHERE id = ${actualIds.folio}`;
    await client`DELETE FROM reservations WHERE id = ${actualIds.reservation}`;
    await client`DELETE FROM bookings WHERE id = ${actualIds.booking}`;
    await client`DELETE FROM rooms WHERE id = ${actualIds.room}`;
    await client`DELETE FROM rate_plans WHERE id = ${actualIds.ratePlan}`;
    await client`DELETE FROM room_types WHERE id = ${actualIds.roomType}`;
    await client`DELETE FROM properties WHERE id = ${actualIds.property}`;
    await client`DELETE FROM properties WHERE id = ${actualIds.secondProperty}`;
    await client`DELETE FROM guests WHERE id = ${actualIds.guest}`;
  }

  async function setupActualServiceFixture() {
    await cleanupActualServiceFixture();
    const acceptedPricingSnapshot = {
      version: 1,
      source: 'current',
      currencyCode: 'EUR',
      grandTotal: '122.00',
      roomTotal: '100.00',
      taxTotal: '0.00',
      nights: [{ date: '2026-10-01', roomAmount: '100.00', taxAmount: '0.00' }],
      services: [{
        serviceId: actualIds.service,
        code: 'T12PARK',
        name: 'Task 12 parking',
        postingRule: 'once',
        chargeType: 'parking',
        currencyCode: 'EUR',
        unitPrice: '20.00',
        quantity: 1,
        lineTotal: '20.00',
        taxTotal: '2.00',
        lineItems: [{ date: '2026-10-01', amount: '20.00', taxAmount: '2.00' }],
      }],
      servicesTotal: '20.00',
      servicesTaxTotal: '2.00',
      customReason: null,
      adjustment: null,
    };
    await client`
      INSERT INTO properties
        (id, name, code, country_code, timezone, currency_code, total_rooms)
      VALUES
        (${actualIds.property}, 'Task 12 race', 'T12RACE', 'ES', 'Europe/Madrid', 'EUR', 1)
    `;
    await client`
      INSERT INTO guests (id, first_name, last_name)
      VALUES (${actualIds.guest}, 'Task', 'Twelve')
    `;
    await client`
      INSERT INTO room_types
        (id, property_id, name, code, max_occupancy, default_occupancy)
      VALUES
        (${actualIds.roomType}, ${actualIds.property}, 'Race room', 'T12ROOM', 2, 1)
    `;
    await client`
      INSERT INTO rate_plans
        (id, property_id, room_type_id, name, code, type, base_amount, currency_code)
      VALUES
        (${actualIds.ratePlan}, ${actualIds.property}, ${actualIds.roomType},
          'Task 12 race', 'T12RATE', 'bar', 100.00, 'EUR')
    `;
    await client`
      INSERT INTO rooms (id, property_id, room_type_id, number, status)
      VALUES (${actualIds.room}, ${actualIds.property}, ${actualIds.roomType}, 'T12-101', 'occupied')
    `;
    await client`
      INSERT INTO bookings
        (id, property_id, guest_id, confirmation_number, source)
      VALUES
        (${actualIds.booking}, ${actualIds.property}, ${actualIds.guest}, 'T12-RACE-CONF', 'direct')
    `;
    await client`
      INSERT INTO reservations
        (id, property_id, booking_id, guest_id, arrival_date, departure_date, nights,
          room_type_id, status, rate_plan_id, total_amount, currency_code,
          accepted_pricing_snapshot)
      VALUES
        (${actualIds.reservation}, ${actualIds.property}, ${actualIds.booking}, ${actualIds.guest},
          '2026-10-01', '2026-10-02', 1, ${actualIds.roomType}, 'checked_in',
          ${actualIds.ratePlan}, 122.00, 'EUR', ${JSON.stringify(acceptedPricingSnapshot)}::jsonb)
    `;
    await client`
      INSERT INTO folios
        (id, property_id, reservation_id, booking_id, guest_id, folio_number,
          type, status, currency_code)
      VALUES
        (${actualIds.folio}, ${actualIds.property}, ${actualIds.reservation},
          ${actualIds.booking}, ${actualIds.guest}, 'T12-RACE-FOLIO', 'guest', 'open', 'EUR')
    `;
    await client`
      INSERT INTO services
        (id, property_id, code, name, charge_type, price, currency_code,
          posting_rule, sell_channels)
      VALUES
        (${actualIds.service}, ${actualIds.property}, 'T12PARK', 'Task 12 parking',
          'parking', 20.00, 'EUR', 'once', ${JSON.stringify(['booking_engine'])}::jsonb)
    `;
    await client`
      INSERT INTO reservation_services
        (id, property_id, reservation_id, service_id, quantity, unit_price,
          currency_code, status, source_channel, posting_rule, charge_type)
      VALUES
        (${actualIds.reservationService}, ${actualIds.property}, ${actualIds.reservation},
          ${actualIds.service}, 1, 20.00, 'EUR', 'confirmed', 'booking_engine', 'once', 'parking')
    `;
    await client`
      INSERT INTO booking_engine_config
        (property_id, is_enabled, booking_mode, sellable_room_type_ids,
          sellable_rate_plan_ids, deposit_policy)
      VALUES
        (${actualIds.property}, true, 'request', ${JSON.stringify([actualIds.roomType])}::jsonb,
          ${JSON.stringify([actualIds.ratePlan])}::jsonb,
          ${JSON.stringify({ type: 'none', refundable: true })}::jsonb)
    `;
    await client`
      INSERT INTO booking_requests
        (id, property_id, submission_idempotency_key, submission_fingerprint,
          status, arrival_date, departure_date, room_type_id, rate_plan_id,
          adults, children, guest_first_name, guest_last_name, guest_email,
          service_ids, submitted_quote_snapshot, currency_code,
          accepted_price_source, accepted_total, accepted_reservation_id,
          accepted_folio_id, decided_at)
      VALUES
        (${actualIds.bookingRequest}, ${actualIds.property}, 'task12-live-amendment',
          ${'a'.repeat(64)}, 'accepted', '2026-10-01', '2026-10-02',
          ${actualIds.roomType}, ${actualIds.ratePlan}, 1, 0, 'Task', 'Twelve',
          'task12@example.invalid', ${JSON.stringify([actualIds.service])}::jsonb,
          ${JSON.stringify(acceptedPricingSnapshot)}::jsonb, 'EUR', 'current', 122.00,
          ${actualIds.reservation}, ${actualIds.folio}, now())
    `;
  }

  async function waitForAdvisoryLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await client<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pg_locks
        WHERE locktype = 'advisory' AND database = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        ) AND granted
      `;
      if ((row?.count ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('accepted-pricing advisory lock was not observed');
  }

  async function reset() {
    await client.unsafe('TRUNCATE task12_accepted_pricing_lock_test.ledger');
    await client.unsafe('TRUNCATE task12_accepted_pricing_lock_test.pricing_state');
    await client`
      INSERT INTO task12_accepted_pricing_lock_test.pricing_state
        (property_id, reservation_id, amount)
      VALUES (${propertyId}, ${reservationId}, 100.00)
    `;
  }

  function actualServiceGraph() {
    const webhook = {
      emit: vi.fn().mockResolvedValue(undefined),
      dispatchPersisted: vi.fn().mockResolvedValue(undefined),
    };
    const tax = new TaxService(db as any);
    const folio = new FolioService(db as any, webhook as any, tax);
    const ancillary = new AncillaryService(db as any, folio, webhook as any);
    const availability = new AvailabilityService(db as any);
    const ratePlan = new RatePlanService(db as any, webhook as any);
    const policy = new PolicyService(db as any, webhook as any);
    const reservation = new ReservationService(
      db as any,
      availability,
      folio,
      {} as any,
      {} as any,
      webhook as any,
      ancillary,
      policy,
      {} as any,
      ratePlan,
    );
    const config = new BookingEngineConfigService(db as any);
    const bookingEngine = new BookingEngineService(
      db as any,
      {} as any,
      {} as any,
      reservation,
      availability,
      ratePlan,
      tax,
      {} as any,
      folio,
      {} as any,
      {} as any,
      config,
      ancillary,
      policy,
    );
    const bookingRequest = new BookingRequestService(
      db as any,
      config,
      bookingEngine,
      availability,
      ratePlan,
      {} as any,
      webhook as any,
      {} as any,
      reservation,
      folio,
      ancillary,
      {} as any,
    );
    const nightAudit = new NightAuditService(
      db as any,
      folio,
      reservation,
      {} as any,
      {} as any,
      webhook as any,
      ancillary,
      policy,
      {} as any,
    );
    return { ancillary, bookingRequest, folio, nightAudit, webhook };
  }

  it('forces a posting path to re-read the amended snapshot before claiming its source', async () => {
    await reset();
    let releaseAmendment!: () => void;
    let amendmentWritten!: () => void;
    const holdAmendment = new Promise<void>((resolve) => { releaseAmendment = resolve; });
    const written = new Promise<void>((resolve) => { amendmentWritten = resolve; });

    const amendment = withAcceptedPricingLock(
      db,
      propertyId,
      reservationId,
      async (tx) => {
        await tx.execute(sql`
          UPDATE task12_accepted_pricing_lock_test.pricing_state
          SET amount = 80.00
          WHERE property_id = ${propertyId} AND reservation_id = ${reservationId}
        `);
        amendmentWritten();
        await holdAmendment;
      },
    );
    await written;

    let postingEntered = false;
    const posting = withAcceptedPricingLock(
      db,
      propertyId,
      reservationId,
      async (tx) => {
        postingEntered = true;
        const rows = await tx.execute(sql<{ amount: string }>`
          SELECT amount::text AS amount
          FROM task12_accepted_pricing_lock_test.pricing_state
          WHERE property_id = ${propertyId} AND reservation_id = ${reservationId}
        `);
        await tx.execute(sql`
          INSERT INTO task12_accepted_pricing_lock_test.ledger (source_key, amount, kind)
          VALUES ('canonical', ${rows[0]!.amount}, 'canonical')
          ON CONFLICT (source_key) DO NOTHING
        `);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postingEntered).toBe(false);

    releaseAmendment();
    await Promise.all([amendment, posting]);

    const [row] = await client<{ amount: string }[]>`
      SELECT amount::text AS amount FROM task12_accepted_pricing_lock_test.ledger
      WHERE source_key = 'canonical'
    `;
    expect(row?.amount).toBe('80.00');
  }, 10_000);

  it('serializes the opposite race and reconciles a claimed old group to the new total', async () => {
    await reset();
    let releasePosting!: () => void;
    let oldGroupClaimed!: () => void;
    const holdPosting = new Promise<void>((resolve) => { releasePosting = resolve; });
    const claimed = new Promise<void>((resolve) => { oldGroupClaimed = resolve; });

    const posting = withAcceptedPricingLock(
      db,
      propertyId,
      reservationId,
      async (tx) => {
        const rows = await tx.execute(sql<{ amount: string }>`
          SELECT amount::text AS amount
          FROM task12_accepted_pricing_lock_test.pricing_state
          WHERE property_id = ${propertyId} AND reservation_id = ${reservationId}
        `);
        await tx.execute(sql`
          INSERT INTO task12_accepted_pricing_lock_test.ledger (source_key, amount, kind)
          VALUES ('canonical', ${rows[0]!.amount}, 'canonical')
        `);
        oldGroupClaimed();
        await holdPosting;
      },
    );
    await claimed;

    let amendmentEntered = false;
    const amendment = withAcceptedPricingLock(
      db,
      propertyId,
      reservationId,
      async (tx) => {
        amendmentEntered = true;
        await tx.execute(sql`
          UPDATE task12_accepted_pricing_lock_test.pricing_state
          SET amount = 80.00
          WHERE property_id = ${propertyId} AND reservation_id = ${reservationId}
        `);
        const rows = await tx.execute(sql<{ posted: string }>`
          SELECT coalesce(sum(amount), 0)::text AS posted
          FROM task12_accepted_pricing_lock_test.ledger
        `);
        await tx.execute(sql`
          INSERT INTO task12_accepted_pricing_lock_test.ledger (source_key, amount, kind)
          VALUES ('amendment:1', 80.00 - ${rows[0]!.posted}::numeric, 'amendment-adjustment')
        `);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(amendmentEntered).toBe(false);

    releasePosting();
    await Promise.all([posting, amendment]);

    const [row] = await client<{ total: string; reversals: number }[]>`
      SELECT sum(amount)::text AS total,
        count(*) FILTER (WHERE kind = 'reversal')::int AS reversals
      FROM task12_accepted_pricing_lock_test.ledger
    `;
    expect(row).toEqual({ total: '80.00', reversals: 0 });
  }, 10_000);

  it('runs the real amendment and night-audit write seams without claiming a stale room group', async () => {
    await setupActualServiceFixture();
    const { bookingRequest, nightAudit } = actualServiceGraph();
    await client`
      UPDATE rate_plans SET base_amount = 80.00
      WHERE id = ${actualIds.ratePlan} AND property_id = ${actualIds.property}
    `;
    const dates = { arrivalDate: '2026-10-01', departureDate: '2026-10-02' };
    const preview = await bookingRequest.stayAmendmentPreview(
      actualIds.bookingRequest,
      actualIds.property,
      { propertyId: actualIds.property, ...dates },
    );

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION task12_delay_amendment() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${actualIds.reservation}'::uuid
          AND NEW.accepted_pricing_snapshot IS DISTINCT FROM OLD.accepted_pricing_snapshot THEN
          PERFORM pg_sleep(0.35);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.unsafe(`
      CREATE TRIGGER task12_delay_amendment BEFORE UPDATE ON reservations
      FOR EACH ROW EXECUTE FUNCTION task12_delay_amendment()
    `);

    const amendment = bookingRequest.amendStay(
      actualIds.bookingRequest,
      actualIds.property,
      {
        ...dates,
        priceSource: 'current',
        previewToken: preview.previewToken,
        idempotencyKey: 'task12-live-amend-vs-audit',
      },
      { userEmail: 'night.manager@example.invalid' },
    );
    await waitForAdvisoryLock();
    const tariffPosting = nightAudit.postRoomTariffs(actualIds.property, '2026-10-01');

    const [amended, tariff] = await Promise.all([amendment, tariffPosting]);
    expect(amended).toMatchObject({
      previousTotalAmount: '122.00',
      newTotalAmount: '100.00',
      priceSource: 'current',
    });
    expect(tariff).toMatchObject({ totalRoom: '80.00', totalTax: '0.00', count: 1, errors: [] });

    const roomLedger = await client<{ amount: string; sourceKey: string }[]>`
      SELECT amount::text AS amount, source_key AS "sourceKey"
      FROM charges
      WHERE property_id = ${actualIds.property} AND type = 'room'
    `;
    expect(roomLedger).toEqual([{
      amount: '80.00',
      sourceKey: `accepted-pricing:reservation:${actualIds.reservation}:night:2026-10-01`,
    }]);
    await expect(
      nightAudit.postRoomTariffs(actualIds.property, '2026-10-01'),
    ).resolves.toMatchObject({ count: 0, errors: [] });
    const [roomCount] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM charges
      WHERE property_id = ${actualIds.property} AND type = 'room'
    `;
    expect(roomCount?.count).toBe(1);
  }, 30_000);

  it('reconciles a room group claimed by real night audit before the real amendment', async () => {
    await setupActualServiceFixture();
    const { bookingRequest, nightAudit, webhook } = actualServiceGraph();
    await client`
      UPDATE rate_plans SET base_amount = 80.00
      WHERE id = ${actualIds.ratePlan} AND property_id = ${actualIds.property}
    `;
    const dates = { arrivalDate: '2026-10-01', departureDate: '2026-10-02' };
    const preview = await bookingRequest.stayAmendmentPreview(
      actualIds.bookingRequest,
      actualIds.property,
      { propertyId: actualIds.property, ...dates },
    );
    const amendmentInput = {
      ...dates,
      priceSource: 'current' as const,
      previewToken: preview.previewToken,
      idempotencyKey: 'task12-live-audit-vs-amend',
    };

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION task12_delay_charge() RETURNS trigger AS $$
      BEGIN
        IF NEW.source_key = 'accepted-pricing:reservation:${actualIds.reservation}:night:2026-10-01' THEN
          PERFORM pg_sleep(0.35);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.unsafe(`
      CREATE TRIGGER task12_delay_charge BEFORE INSERT ON charges
      FOR EACH ROW EXECUTE FUNCTION task12_delay_charge()
    `);

    const tariffPosting = nightAudit.postRoomTariffs(actualIds.property, '2026-10-01');
    await waitForAdvisoryLock();
    const amendment = bookingRequest.amendStay(
      actualIds.bookingRequest,
      actualIds.property,
      amendmentInput,
      { userEmail: 'night.manager@example.invalid' },
    );

    const [tariff, amended] = await Promise.all([tariffPosting, amendment]);
    expect(tariff).toMatchObject({
      totalRoom: '100.00',
      totalTax: '0.00',
      count: 1,
      errors: [],
    });
    expect(amended).toMatchObject({
      previousTotalAmount: '122.00',
      newTotalAmount: '100.00',
      priceSource: 'current',
    });

    const roomLedger = await client<{
      id: string;
      amount: string;
      isReversal: boolean;
      sourceKey: string | null;
      adjustsChargeId: string | null;
      parentChargeId: string | null;
    }[]>`
      SELECT id, amount::text AS amount, is_reversal AS "isReversal",
        source_key AS "sourceKey", adjusts_charge_id AS "adjustsChargeId",
        parent_charge_id AS "parentChargeId"
      FROM charges
      WHERE property_id = ${actualIds.property} AND type = 'room'
      ORDER BY created_at, id
    `;
    expect(roomLedger).toHaveLength(2);
    const base = roomLedger.find((row) => row.adjustsChargeId == null);
    const correction = roomLedger.find((row) => row.adjustsChargeId != null);
    expect(base).toMatchObject({
      amount: '100.00',
      isReversal: false,
      sourceKey: `accepted-pricing:reservation:${actualIds.reservation}:night:2026-10-01`,
      parentChargeId: null,
    });
    expect(correction).toMatchObject({
      amount: '-20.00',
      isReversal: false,
      adjustsChargeId: base?.id,
      parentChargeId: base?.id,
    });
    expect(correction?.sourceKey).toContain(
      `accepted-pricing:reservation:${actualIds.reservation}:amendment:${amended.amendmentId}`,
    );
    expect(roomLedger.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(80);

    const replay = await bookingRequest.amendStay(
      actualIds.bookingRequest,
      actualIds.property,
      amendmentInput,
      { userEmail: 'night.manager@example.invalid' },
    );
    expect(replay.amendmentId).toBe(amended.amendmentId);
    await expect(
      nightAudit.postRoomTariffs(actualIds.property, '2026-10-01'),
    ).resolves.toMatchObject({ count: 0, errors: [] });

    const [effects] = await client<{
      ledgerCount: number;
      reversals: number;
      amendmentCount: number;
      auditCount: number;
      consequenceCount: number;
      completedConsequences: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM charges
          WHERE property_id = ${actualIds.property} AND type = 'room') AS "ledgerCount",
        (SELECT count(*)::int FROM charges
          WHERE property_id = ${actualIds.property} AND is_reversal) AS reversals,
        (SELECT count(*)::int FROM booking_request_stay_amendments
          WHERE property_id = ${actualIds.property}
            AND booking_request_id = ${actualIds.bookingRequest}) AS "amendmentCount",
        (SELECT count(*)::int FROM audit_logs
          WHERE property_id = ${actualIds.property}
            AND booking_request_id = ${actualIds.bookingRequest}
            AND description = 'Accepted Booking Request stay amended') AS "auditCount",
        (SELECT count(*)::int FROM booking_request_consequences
          WHERE property_id = ${actualIds.property}
            AND booking_request_id = ${actualIds.bookingRequest}
            AND kind LIKE 'amend:%') AS "consequenceCount",
        (SELECT count(*)::int FROM booking_request_consequences
          WHERE property_id = ${actualIds.property}
            AND booking_request_id = ${actualIds.bookingRequest}
            AND kind LIKE 'amend:%' AND status = 'completed') AS "completedConsequences"
    `;
    expect(effects).toEqual({
      ledgerCount: 2,
      reversals: 0,
      amendmentCount: 1,
      auditCount: 1,
      consequenceCount: 1,
      completedConsequences: 1,
    });
    expect(webhook.dispatchPersisted).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('serializes the real ancillary posting and cancellation service seams', async () => {
    await setupActualServiceFixture();
    const webhookService = { emit: vi.fn().mockResolvedValue(undefined) };
    const taxService = { calculateTaxes: vi.fn().mockResolvedValue([]) };
    const folioService = new FolioService(
      db as any,
      webhookService as any,
      taxService as any,
    );
    const ancillary = new AncillaryService(db as any, folioService, webhookService as any);

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION task12_delay_cancel() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${actualIds.reservationService}'::uuid AND NEW.status = 'cancelled' THEN
          PERFORM pg_sleep(0.35);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.unsafe(`
      CREATE TRIGGER task12_delay_cancel BEFORE UPDATE ON reservation_services
      FOR EACH ROW EXECUTE FUNCTION task12_delay_cancel()
    `);

    const cancellation = ancillary.cancelReservationService(
      actualIds.reservationService,
      actualIds.property,
      actualIds.reservation,
    );
    await waitForAdvisoryLock();
    const stalePosting = ancillary.postOnceForReservation(
      actualIds.reservation,
      actualIds.property,
    );
    const [cancelled, postResult] = await Promise.all([cancellation, stalePosting]);

    expect(cancelled.status).toBe('cancelled');
    expect(postResult.count).toBe(0);
    const [cancelFirstLedger] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM charges
      WHERE property_id = ${actualIds.property}
        AND source_key LIKE 'accepted-pricing:reservation-service:%'
    `;
    expect(cancelFirstLedger?.count).toBe(0);

    await client.unsafe('DROP TRIGGER task12_delay_cancel ON reservation_services');
    await client.unsafe('DROP FUNCTION task12_delay_cancel()');
    await client`
      UPDATE reservation_services SET status = 'confirmed'
      WHERE id = ${actualIds.reservationService}
    `;

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION task12_delay_charge() RETURNS trigger AS $$
      BEGIN
        IF NEW.source_key LIKE 'accepted-pricing:reservation-service:%' THEN
          PERFORM pg_sleep(0.35);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.unsafe(`
      CREATE TRIGGER task12_delay_charge BEFORE INSERT ON charges
      FOR EACH ROW EXECUTE FUNCTION task12_delay_charge()
    `);

    const posting = ancillary.postOnceForReservation(
      actualIds.reservation,
      actualIds.property,
    );
    await waitForAdvisoryLock();
    const losingCancellation = ancillary.cancelReservationService(
      actualIds.reservationService,
      actualIds.property,
      actualIds.reservation,
    );

    await expect(posting).resolves.toMatchObject({ count: 1 });
    await expect(losingCancellation).rejects.toThrow(/posted reservation service/i);
    const [finalRow] = await client<{ status: string }[]>`
      SELECT status::text AS status FROM reservation_services
      WHERE id = ${actualIds.reservationService}
    `;
    expect(finalRow?.status).toBe('posted');
    const ledger = await client<{
      id: string;
      type: string;
      amount: string;
      sourceKey: string | null;
      parentChargeId: string | null;
    }[]>`
      SELECT id, type::text AS type, amount::text AS amount,
        source_key AS "sourceKey", parent_charge_id AS "parentChargeId"
      FROM charges
      WHERE property_id = ${actualIds.property}
      ORDER BY type
    `;
    expect(ledger).toHaveLength(2);
    const base = ledger.find((row) => row.type === 'parking');
    const tax = ledger.find((row) => row.type === 'tax');
    expect(base).toMatchObject({
      amount: '20.00',
      sourceKey: `accepted-pricing:reservation-service:${actualIds.reservationService}:once:2026-10-01`,
      parentChargeId: null,
    });
    expect(tax).toMatchObject({
      amount: '2.00',
      sourceKey: null,
      parentChargeId: base?.id,
    });
  }, 20_000);

  it('enforces accepted correction provenance inside one property in PostgreSQL', async () => {
    await setupActualServiceFixture();
    await client`
      INSERT INTO properties
        (id, name, code, country_code, timezone, currency_code, total_rooms)
      VALUES
        (${actualIds.secondProperty}, 'Task 12 second tenant', 'T12RACE2',
          'ES', 'Europe/Madrid', 'EUR', 1)
    `;
    await client`
      INSERT INTO folios
        (id, property_id, guest_id, folio_number, type, status, currency_code)
      VALUES
        (${actualIds.secondFolio}, ${actualIds.secondProperty}, ${actualIds.guest},
          'T12-RACE-SECOND', 'guest', 'open', 'EUR')
    `;
    await client`
      INSERT INTO charges
        (id, property_id, folio_id, type, description, amount, currency_code,
          service_date, is_reversal)
      VALUES
        (${actualIds.baseCharge}, ${actualIds.property}, ${actualIds.folio}, 'room',
          'Task 12 base', 100.00, 'EUR', '2026-10-01', false)
    `;

    await expect(client`
      INSERT INTO charges
        (id, property_id, folio_id, type, description, amount, currency_code,
          service_date, is_reversal, adjusts_charge_id)
      VALUES
        (${actualIds.correctionCharge}, ${actualIds.secondProperty}, ${actualIds.secondFolio},
          'adjustment', 'Cross-property correction', -20.00, 'EUR', '2026-10-01',
          false, ${actualIds.baseCharge})
    `).rejects.toThrow(/charges_adjusts_charge_property_fkey/i);

    const [constraint] = await client<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'charges_adjusts_charge_property_fkey'
        AND conrelid = 'charges'::regclass
    `;
    expect(constraint?.definition).toContain(
      'FOREIGN KEY (property_id, adjusts_charge_id) REFERENCES charges(property_id, id)',
    );
  }, 10_000);
});
