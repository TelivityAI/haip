import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@telivityhaip/database';
import { postgresOptionsFromEnv } from '@telivityhaip/database';
import { isBookingRequestsEnabled } from '@telivityhaip/booking-requests';

export const DRIZZLE = Symbol('DRIZZLE');

async function loadSchema() {
  if (!isBookingRequestsEnabled()) return schema;
  const bookingRequestsSchema = await import('@telivityhaip/booking-requests/schema');
  return { ...schema, ...bookingRequestsSchema };
}

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
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
  exports: [DRIZZLE],
})
export class DatabaseModule {}
