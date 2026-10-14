/** Map a hosted-checkout read or webhook payment onto HAIP's pending hold. */
export function classifyHostedCheckout(input: {
  sessionStatus?: string | null;
  paymentStatus?: string | null;
  statusCode?: number | null;
  isAuthorized?: boolean | null;
  statusCategory?: string | null;
  paymentStatusCategory?: string | null;
}): 'authorized' | 'failed' | 'pending' {
  const status = (input.paymentStatus ?? '').toUpperCase();
  const session = (input.sessionStatus ?? '').toUpperCase();
  const category = (input.statusCategory ?? input.paymentStatusCategory ?? '').toUpperCase();
  if (input.statusCode === 5 || status === 'PENDING_CAPTURE' || input.isAuthorized === true) {
    return 'authorized';
  }
  if (
    session === 'CANCELLED_BY_CONSUMER'
    || status === 'CANCELLED'
    || status === 'REJECTED'
    || category === 'REJECTED'
    || input.statusCode === 1
  ) {
    return 'failed';
  }
  return 'pending';
}

/** Prefer the full redirect URL. Older responses only include the partial path. */
export function hostedCheckoutRedirectUrl(body: {
  redirectUrl?: string | null;
  partialRedirectUrl?: string | null;
}): string | null {
  const full = body.redirectUrl?.trim();
  if (full) return full;
  const partial = body.partialRedirectUrl?.trim().replace(/^\//, '');
  if (!partial) return null;
  return `https://payment.${partial}`;
}
