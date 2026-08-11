import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@telivityhaip/database';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>(
          'DATABASE_URL',
          'postgresql://haip:haip@localhost:5432/haip',
        );
        // Transaction-pooling poolers (pgbouncer, RDS Proxy, Supabase pooler) cannot
        // support postgres.js's default named prepared statements: the statement is
        // prepared on one backend connection and executed on another. Setting
        // DATABASE_POOLER_MODE=transaction disables them; direct connections keep the
        // default, where prepared statements are a real win.
        const prepare =
          config.get<string>('DATABASE_POOLER_MODE', '') !== 'transaction';
        // DATABASE_SSL=no-verify: TLS on, chain unverified — for poolers that
        // terminate TLS with a private or self-signed certificate. sslmode in the
        // connection URL is not honoured consistently across postgres.js versions,
        // so this is explicit rather than a URL parameter.
        const sslEnv = config.get<string>('DATABASE_SSL', '');
        const ssl =
          sslEnv === 'no-verify' ? { rejectUnauthorized: false } : undefined;
        const client = postgres(url, { prepare, ...(ssl ? { ssl } : {}) });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
