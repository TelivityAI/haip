/**
 * CLI: link a Keycloak service-account sub to a local user + integration role.
 *
 * Usage:
 *   pnpm integration:link -- --property-id <uuid> --keycloak-sub <uuid> --label my-bot --profile inventory
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';
import { postgresOptionsFromEnv } from './postgres-options.js';
import {
  type IntegrationProfile,
  INTEGRATION_PROFILES,
  linkIntegrationPrincipal,
} from './integration-principal.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { args, positional };
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));

  const propertyId = args['property_id'];
  const keycloakSub = args['keycloak_sub'];
  const label = args['label'];
  const profileRaw = args['profile'] ?? 'inventory';
  const permissionsRaw = args['permissions'];

  if (!propertyId || !keycloakSub || !label) {
    console.error(
      'Usage: pnpm integration:link -- --property-id <uuid> --keycloak-sub <uuid> --label <name> --profile inventory|reservations|custom [--permissions key1,key2]',
    );
    process.exit(1);
  }

  const profile = profileRaw as IntegrationProfile;
  if (!['inventory', 'reservations', 'custom'].includes(profile)) {
    console.error(`Invalid --profile: ${profileRaw}. Use inventory, reservations, or custom.`);
    process.exit(1);
  }

  const permissions = permissionsRaw
    ? permissionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  if (profile !== 'custom' && profile in INTEGRATION_PROFILES) {
    const def = INTEGRATION_PROFILES[profile as 'inventory' | 'reservations'];
    console.log(`Profile ${profile}: role ${def.roleKey}, permissions: ${def.permissions.join(', ')}`);
  }

  const client = postgres(DATABASE_URL, postgresOptionsFromEnv());
  const db = drizzle(client, { schema });

  try {
    const result = await linkIntegrationPrincipal(db, {
      propertyId,
      keycloakSub,
      label,
      profile,
      permissions,
    });

    console.log('Integration principal linked:');
    console.log(`  userId:     ${result.userId}`);
    console.log(`  email:      ${result.email}`);
    console.log(`  roleKey:    ${result.roleKey}`);
    console.log(`  roleId:     ${result.roleId}`);
    console.log(`  userCreated: ${result.userCreated}`);
    console.log(`  roleCreated: ${result.roleCreated}`);
    console.log(`  assignmentCreated: ${result.assignmentCreated}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
