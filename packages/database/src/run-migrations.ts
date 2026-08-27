/**
 * HAIP database migrate entrypoint — baseline push-schema + tracked SQL (0022+).
 */
import { runAllMigrations } from './migration-runner.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

runAllMigrations(DATABASE_URL).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
