/**
 * Build the guest-facing check-in URL for a magic token.
 * `origin` is the booking app root (e.g. http://localhost:5174 or https://host/booking).
 */
export function buildCheckInAppUrl(origin: string, token: string, extraQuery?: Record<string, string>): string {
  const base = origin.replace(/\/$/, '');
  const params = new URLSearchParams({ token, ...(extraQuery ?? {}) });
  return `${base}/check-in?${params.toString()}`;
}
