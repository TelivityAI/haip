import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@telivityhaip/database';
import { DRIZZLE as DRIZZLE_TOKEN, postgresOptionsFromEnv } from '@telivityhaip/database';
// `@telivityhaip/shared`, NOT `@telivityhaip/booking-requests`: this module is
// foundational (every DB-touching provider transitively imports it for
// DRIZZLE), so a static import of the full booking-requests bundle here would
// force it into every test file's module graph — breaking any test that
// partially mocks `@telivityhaip/database` with `vi.mock(...)` (booking-requests'
// bundle imports that module too). The package's own optional Drizzle schema
// merge below is loaded with a dynamic `import()` instead, gated by this same
// flag, so it only loads when the feature is actually enabled.
import { isBookingRequestsEnabled } from '@telivityhaip/shared';

/**
 * Re-exported (via a re-export clause, NOT `import { DRIZZLE } from ...` +
 * `export { DRIZZLE }`) for the ~160 existing call sites importing DRIZZLE
 * from here. The two-step import-then-export form previously here compiled
 * to a broken live-binding getter under Vite/Vitest's SSR module transform
 * (`ReferenceError: DRIZZLE is not defined` at every call site, even when
 * `@telivityhaip/database` was not mocked at all) — this single re-export
 * statement sidesteps that transform bug entirely.
 */
export { DRIZZLE } from '@telivityhaip/database';

async function loadSchema() {
  if (!isBookingRequestsEnabled()) return schema;
  const bookingRequestsSchema = await import('@telivityhaip/booking-requests/schema');
  return { ...schema, ...bookingRequestsSchema };
}

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_TOKEN,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>(
          'DATABASE_URL',
          'postgresql://haip:haip@localhost:5432/haip',
        );
        const client = postgres(
          url,
          postgresOptionsFromEnv({
            DATABASE_POOLER_MODE: config.get<string>('DATABASE_POOLER_MODE'),
            DATABASE_SSL: config.get<string>('DATABASE_SSL'),
          }),
        );
        const mergedSchema = await loadSchema();
        return drizzle(client, { schema: mergedSchema });
      },
    },
  ],
  exports: [DRIZZLE_TOKEN],
})
export class DatabaseModule {}
