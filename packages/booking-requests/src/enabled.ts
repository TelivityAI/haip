/**
 * Canonical definition lives in `@telivityhaip/shared` so core modules that
 * need this trivial flag check (e.g. `apps/api`'s `DatabaseModule`) can
 * import it without pulling in this package's full compiled bundle.
 */
export { isBookingRequestsEnabled } from '@telivityhaip/shared';
