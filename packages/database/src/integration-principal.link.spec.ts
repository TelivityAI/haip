/**
 * DB integration tests for multi-property integration:link.
 * Requires Postgres (CI sets DATABASE_URL to haip_test).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index.js';
import { postgresOptionsFromEnv } from './postgres-options.js';
import { linkIntegrationPrincipal } from './integration-principal.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip_test';

const PROP_A = 'f3440001-0000-4000-a000-000000000001';
const PROP_B = 'f3440002-0000-4000-a000-000000000002';
const KEYCLOAK_SUB = 'f3440003-0000-4000-a000-000000000003';
const LABEL = 'multi-prop-test';

describe('linkIntegrationPrincipal multi-property', () => {
  const client = postgres(DATABASE_URL, postgresOptionsFromEnv());
  const db = drizzle(client, { schema });

  beforeAll(async () => {
    for (const [id, code] of [
      [PROP_A, 'F344A'],
      [PROP_B, 'F344B'],
    ] as const) {
      const [existing] = await db
        .select({ id: schema.properties.id })
        .from(schema.properties)
        .where(eq(schema.properties.id, id))
        .limit(1);
      if (!existing) {
        await db.insert(schema.properties).values({
          id,
          name: `Issue 344 test ${code}`,
          code,
          countryCode: 'US',
          timezone: 'America/New_York',
          currencyCode: 'USD',
          totalRooms: 10,
        });
      }
    }
  });

  afterAll(async () => {
    const email = `svc-multi-prop-test@integrations.local`;
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (user) {
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, user.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    }
    await client.end();
  });

  it('links the same keycloakSub on a second property without moving home propertyId', async () => {
    const first = await linkIntegrationPrincipal(db, {
      propertyId: PROP_A,
      keycloakSub: KEYCLOAK_SUB,
      label: LABEL,
      profile: 'inventory',
    });

    const second = await linkIntegrationPrincipal(db, {
      propertyId: PROP_B,
      keycloakSub: KEYCLOAK_SUB,
      label: LABEL,
      profile: 'inventory',
    });

    expect(second.userId).toBe(first.userId);
    expect(second.userCreated).toBe(false);
    expect(second.assignmentCreated).toBe(true);

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, first.userId))
      .limit(1);
    expect(user?.propertyId).toBe(PROP_A);

    const assignments = await db
      .select({ propertyId: schema.userRoles.propertyId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, first.userId));
    const linkedProperties = assignments.map((a) => a.propertyId).sort();
    expect(linkedProperties).toEqual([PROP_A, PROP_B].sort());
  });
});
