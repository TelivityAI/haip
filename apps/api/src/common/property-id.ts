import { BadRequestException, ForbiddenException } from '@nestjs/common';

const QUERY_BODY_MISMATCH =
  'propertyId in query and body must match when both are provided';

const REQUEST_LOCATIONS_MISMATCH =
  'propertyId in query, body, and route params must match when more than one is provided';

/**
 * Resolve propertyId for write endpoints that historically required it in the
 * body while sibling reads take `?propertyId=` (issue #321 item 1).
 *
 * Rules:
 * - Body present → use body (existing clients unchanged).
 * - Body omitted, query present → use query.
 * - Both present and unequal → 400 (do not silently prefer one).
 * - Neither present → 400.
 *
 * Callers must still pass the resolved id into services — never infer it from
 * another entity lookup (confused-deputy).
 */
export function resolvePropertyId(opts: {
  body?: string | null;
  query?: string | null;
}): string {
  const body = normalize(opts.body);
  const query = normalize(opts.query);

  if (body && query && body !== query) {
    throw new BadRequestException(QUERY_BODY_MISMATCH);
  }

  const resolved = body ?? query;
  if (!resolved) {
    throw new BadRequestException(
      'propertyId is required (JSON body propertyId, or ?propertyId= query alias)',
    );
  }
  return resolved;
}

/**
 * Read the single propertyId carried on an HTTP request (query, JSON body, route
 * param). Used by global guards so authorization and permission checks use the
 * same tenant id handlers will act on — never the first-present location alone.
 *
 * - No propertyId anywhere → undefined (route may not be property-scoped).
 * - One location → that value.
 * - Multiple locations → all must match or 400.
 * - Non-scalar (e.g. duplicated query array) → 403 (fail closed).
 */
export function resolveRequestPropertyId(parts: {
  query?: unknown;
  body?: unknown;
  params?: unknown;
}): string | undefined {
  const present: string[] = [];
  for (const raw of [parts.query, parts.body, parts.params]) {
    const id = readScalarPropertyId(raw);
    if (id) present.push(id);
  }
  if (present.length === 0) return undefined;
  const resolved = present[0]!;
  if (present.some((id) => id !== resolved)) {
    throw new BadRequestException(REQUEST_LOCATIONS_MISMATCH);
  }
  return resolved;
}

function readScalarPropertyId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new ForbiddenException('Invalid propertyId');
  }
  return normalize(raw);
}

function normalize(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
