import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { properties } from '@telivityhaip/database';
import { IntegrationsService } from '../modules/integrations/integrations.service';

/** Deployment data migration. Reads connection/key-ring configuration only from the environment. */
async function main() {
  if (!process.env['DATABASE_URL']) throw new Error('Database configuration is required');
  const client = postgres(process.env['DATABASE_URL'], { max: 1 });
  try {
    const db = drizzle(client);
    const integrations = new IntegrationsService(db);
    // Properties are tenants; every credential operation below is property-scoped.
    const tenants = await db.select({ id: properties.id }).from(properties);
    for (const tenant of tenants) await integrations.protectRedsysCredentials(tenant.id);
    process.stdout.write(`Redsys credential protection completed for ${tenants.length} properties.\n`);
  } finally {
    await client.end();
  }
}

void main().catch(() => {
  // Never print a DB error, config value, ciphertext, or decrypted credential.
  process.stderr.write('Redsys credential protection failed. Check database and credential key-ring configuration; rerun before accepting payments.\n');
  process.exitCode = 1;
});
