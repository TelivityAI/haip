/**
 * Injection token for the shared Drizzle database client. Declared here (not
 * in apps/api) so packages that own their own Nest slice — e.g.
 * @telivityhaip/booking-requests — can `@Inject(DRIZZLE)` the same instance
 * apps/api's `DatabaseModule` provides `@Global()`, without importing apps/api.
 */
export const DRIZZLE = Symbol('DRIZZLE');
