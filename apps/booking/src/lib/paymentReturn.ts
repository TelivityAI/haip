/** Bootstrap the self-contained router after a full-page hosted checkout return. */
export function paymentReturnEntry(href: string): string {
  const reference = new URL(href).searchParams.get('haip_payment_return');
  return reference && /^[A-Za-z0-9_-]{43}$/.test(reference)
    ? `/payment-return?reference=${encodeURIComponent(reference)}` : '/';
}
