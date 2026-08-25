import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { withAcceptedPricingLock } from './accepted-pricing-lock';

const live = process.env['ACCEPTED_PRICING_LIVE_PG'] === '1';
const databaseUrl = process.env['DATABASE_URL'];
const suite = live && databaseUrl ? describe : describe.skip;

suite('accepted-pricing mutex against PostgreSQL', () => {
  const propertyId = 'property-race';
  const reservationId = 'reservation-race';
  const client = postgres(databaseUrl!, { max: 8 });
  const db = drizzle(client);

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
    await client.unsafe('DROP SCHEMA IF EXISTS task12_accepted_pricing_lock_test CASCADE');
    await client.end();
  });

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
});
