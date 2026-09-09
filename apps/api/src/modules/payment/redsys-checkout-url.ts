/**
 * Embed a durable Redsys checkout token into browser return URLs so the
 * MemoryRouter booking widget can recover after a full-page redirect.
 */
export function withRedsysCheckoutParams(
  url: string,
  checkoutToken: string,
  outcome: 'ok' | 'ko',
): string {
  const parsed = new URL(url);
  parsed.searchParams.set('haip_checkout', checkoutToken);
  parsed.searchParams.set('redsys', outcome);
  return parsed.toString();
}
