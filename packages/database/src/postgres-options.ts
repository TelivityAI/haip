/**
 * Shared postgres.js options for HAIP database connections.
 *
 * Used by the API, seed, and push-schema so pooler/TLS behaviour cannot drift.
 *
 * - DATABASE_POOLER_MODE=transaction → prepare: false (required under
 *   transaction-pooling poolers: pgbouncer, RDS Proxy, Supabase).
 * - DATABASE_SSL=no-verify → TLS on, certificate chain not verified.
 *   Prefer a real CA / sslrootcert when possible; no-verify is a MITM tradeoff.
 */

export type PostgresOptionsFromEnv = {
  prepare: boolean;
  ssl?: { rejectUnauthorized: false };
};

export type PostgresPoolerEnv = {
  DATABASE_POOLER_MODE?: string | null;
  DATABASE_SSL?: string | null;
};

export function postgresOptionsFromEnv(
  env: PostgresPoolerEnv = process.env,
): PostgresOptionsFromEnv {
  const prepare = env.DATABASE_POOLER_MODE !== 'transaction';
  if (env.DATABASE_SSL === 'no-verify') {
    return { prepare, ssl: { rejectUnauthorized: false } };
  }
  return { prepare };
}
