import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { withAcceptedPricingLock } from './accepted-pricing-lock';
import { AncillaryService } from '../../modules/ancillary/ancillary.service';

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
    await client`
      DELETE FROM charges
      WHERE id IN (${actualIds.baseCharge}, ${actualIds.correctionCharge})
    `;
    await client`DELETE FROM reservation_services WHERE id = ${actualIds.reservationService}`;
    await client`DELETE FROM services WHERE id = ${actualIds.service}`;
    await client`DELETE FROM folios WHERE id = ${actualIds.secondFolio}`;
    await client`DELETE FROM folios WHERE id = ${actualIds.folio}`;
    await client`DELETE FROM reservations WHERE id = ${actualIds.reservation}`;
    await client`DELETE FROM bookings WHERE id = ${actualIds.booking}`;
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
      grandTotal: '22.00',
      roomTotal: '0.00',
      taxTotal: '0.00',
      nights: [],
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
          ${actualIds.ratePlan}, 22.00, 'EUR', ${JSON.stringify(acceptedPricingSnapshot)}::jsonb)
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

  it('serializes the real ancillary posting and cancellation service seams', async () => {
    await setupActualServiceFixture();
    const folioService = {
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'task12-charge' },
        wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn().mockResolvedValue(undefined),
    };
    const webhookService = { emit: vi.fn().mockResolvedValue(undefined) };
    const ancillary = new AncillaryService(db as any, folioService as any, webhookService as any);

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
    expect(folioService.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();

    await client.unsafe('DROP TRIGGER task12_delay_cancel ON reservation_services');
    await client.unsafe('DROP FUNCTION task12_delay_cancel()');
    await client`
      UPDATE reservation_services SET status = 'confirmed'
      WHERE id = ${actualIds.reservationService}
    `;

    let postingEntered!: () => void;
    const entered = new Promise<void>((resolve) => { postingEntered = resolve; });
    folioService.postChargeFromSnapshotWithOutcome.mockImplementationOnce(async () => {
      postingEntered();
      return { charge: { id: 'task12-charge' }, wasCreated: true };
    });
    const posting = ancillary.postOnceForReservation(
      actualIds.reservation,
      actualIds.property,
    );
    await entered;
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
    expect(folioService.postChargeFromSnapshotWithOutcome).toHaveBeenCalledTimes(1);
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
    `;
    expect(constraint?.definition).toContain(
      'FOREIGN KEY (property_id, adjusts_charge_id) REFERENCES charges(property_id, id)',
    );
  }, 10_000);
});
