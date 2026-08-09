/**
 * Report endpoints accept an optional `date` query param (YYYY-MM-DD).
 * When omitted, default to today so callers never hit Postgres with undefined.
 */
export function resolveReportDate(date?: string): string {
  const trimmed = date?.trim();
  if (trimmed) return trimmed;
  return new Date().toISOString().slice(0, 10);
}
