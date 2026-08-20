import { BadRequestException } from '@nestjs/common';

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
    throw new BadRequestException(
      'propertyId in query and body must match when both are provided',
    );
  }

  const resolved = body ?? query;
  if (!resolved) {
    throw new BadRequestException(
      'propertyId is required (JSON body propertyId, or ?propertyId= query alias)',
    );
  }
  return resolved;
}

function normalize(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
